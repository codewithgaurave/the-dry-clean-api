import {
  Injectable,
  Inject,
  BadRequestException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { User, UserDocument } from '../database/schemas/user.schema';
import { OtpCode, OtpCodeDocument } from '../database/schemas/otp-code.schema';
import { RefreshToken, RefreshTokenDocument } from '../database/schemas/refresh-token.schema';
import { OrderActorRole } from '../orders/order-status.enum';
import { ISmsAdapter, SMS_ADAPTER } from './sms/sms-adapter.interface';

export interface AuthTokensResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    phone: string;
    name?: string;
    role: OrderActorRole;
    isNewUser: boolean;
  };
}

/**
 * Authentication Service implementing Phone OTP, JWT Issuance & Rotating Refresh Tokens.
 * Source of truth: PRD.md §6.1, §10; TECH_STACK.md §4.1; TODO.md TASK-012.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(OtpCode.name) private readonly otpModel: Model<OtpCodeDocument>,
    @InjectModel(RefreshToken.name)
    private readonly refreshTokenModel: Model<RefreshTokenDocument>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @Inject(SMS_ADAPTER) private readonly smsAdapter: ISmsAdapter,
  ) {}

  /**
   * Request OTP verification code for login or registration.
   * Enforces rate limiting: Max 3 requests per 10 minutes per phone number.
   */
  async requestOtp(
    rawPhone: string,
  ): Promise<{ success: boolean; message: string; expiresInSeconds: number }> {
    const phone = this.normalizePhone(rawPhone);

    // 1. Rate limiting check (PRD.md §10; TECH_STACK.md §8.1)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const recentRequestsCount = await this.otpModel.countDocuments({
      phone,
      createdAt: { $gte: tenMinutesAgo },
    });

    if (recentRequestsCount >= 3) {
      this.logger.warn(`Rate limit triggered for OTP requests on phone: ${phone}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          errorCode: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many OTP requests. Please wait 10 minutes before requesting again.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 2. Generate 6-digit verification code
    const isDevelopment =
      (this.configService.get<string>('nodeEnv') || 'development') !== 'production';
    // Use deterministic OTP 123456 for test numbers (+919876543210, +919718312383) or development fallback
    const code =
      isDevelopment && (phone === '+919876543210' || phone === '+919718312383')
        ? '123456'
        : isDevelopment
          ? '123456'
          : crypto.randomInt(100000, 999999).toString();

    const expiresInSeconds = 600; // 10 minutes
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // 3. Invalidate previous pending codes for this phone
    await this.otpModel.updateMany({ phone, verified: false }, { $set: { verified: true } });

    // 4. Record new OTP
    await this.otpModel.create({
      phone,
      code,
      expiresAt,
      attempts: 0,
      verified: false,
      createdAt: new Date(),
    });

    // 5. Send via SMS Adapter
    await this.smsAdapter.sendOtp(phone, code);

    return {
      success: true,
      message: 'OTP verification code sent successfully.',
      expiresInSeconds,
    };
  }

  /**
   * Verify entered OTP code, authenticate/register user, and issue tokens.
   */
  async verifyOtp(rawPhone: string, otp: string): Promise<AuthTokensResult> {
    const phone = this.normalizePhone(rawPhone);

    // 1. Locate active, unverified, unexpired OTP code
    const otpDoc = await this.otpModel
      .findOne({
        phone,
        verified: false,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 });

    if (!otpDoc) {
      throw new BadRequestException(
        'EXPIRED_OR_INVALID_OTP: The verification code is invalid or has expired.',
      );
    }

    // 2. Check and increment attempt count (Max 3 incorrect entries)
    otpDoc.attempts += 1;
    if (otpDoc.attempts > 3) {
      otpDoc.verified = true; // Invalidate
      await otpDoc.save();
      throw new BadRequestException(
        'MAX_ATTEMPTS_EXCEEDED: Too many incorrect attempts. Please request a new OTP.',
      );
    }

    if (otpDoc.code !== otp.trim()) {
      await otpDoc.save();
      throw new BadRequestException('INVALID_OTP: The verification code entered is incorrect.');
    }

    // Mark verified
    otpDoc.verified = true;
    await otpDoc.save();

    // 3. Find or register User (Customer Account)
    let user = await this.userModel.findOne({ phone });
    let isNewUser = false;

    if (!user) {
      user = await this.userModel.create({
        phone,
        role: OrderActorRole.CUSTOMER,
        isActive: true,
      });
      isNewUser = true;
      this.logger.log(`New customer account registered via phone: ${phone} (ID: ${user._id})`);
    }

    // 4. Issue Short-lived JWT & Rotating Refresh Token
    const tokens = await this.generateTokens(user);

    return {
      ...tokens,
      user: {
        id: user._id.toString(),
        phone: user.phone,
        name: user.name,
        role: user.role,
        isNewUser,
      },
    };
  }

  /**
   * Refresh JWT access token with rotating refresh token pattern.
   */
  async refreshTokens(
    rawRefreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const storedToken = await this.refreshTokenModel.findOne({
      tokenHash,
      revoked: false,
      expiresAt: { $gt: new Date() },
    });

    if (!storedToken) {
      throw new UnauthorizedException(
        'INVALID_REFRESH_TOKEN: Refresh token has expired, been revoked, or is invalid.',
      );
    }

    // Revoke current refresh token to enforce rotation
    storedToken.revoked = true;
    await storedToken.save();

    const user = await this.userModel.findById(storedToken.userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User account no longer active.');
    }

    // Issue brand new token pair
    return this.generateTokens(user);
  }

  /**
   * Logout user by revoking active refresh token.
   */
  async logout(rawRefreshToken: string): Promise<{ success: boolean; message: string }> {
    if (rawRefreshToken) {
      const tokenHash = this.hashToken(rawRefreshToken);
      await this.refreshTokenModel.updateOne({ tokenHash }, { $set: { revoked: true } });
    }
    return { success: true, message: 'Logged out successfully.' };
  }

  /**
   * Helper: Generate JWT Access Token and Rotating Refresh Token
   */
  private async generateTokens(
    user: UserDocument,
  ): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const payload = {
      sub: user._id.toString(),
      phone: user.phone,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);
    const expiresIn = 900; // 15 minutes (TECH_STACK.md §4.1)

    // Generate cryptographic random refresh token
    const rawRefreshToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.refreshTokenModel.create({
      userId: user._id,
      tokenHash,
      expiresAt,
      revoked: false,
      createdAt: new Date(),
    });

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn,
    };
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    return trimmed.startsWith('+') ? trimmed : `+${trimmed}`;
  }
}
