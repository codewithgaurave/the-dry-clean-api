import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { HttpStatus, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { User } from '../database/schemas/user.schema';
import { OtpCode } from '../database/schemas/otp-code.schema';
import { RefreshToken } from '../database/schemas/refresh-token.schema';
import { SMS_ADAPTER } from './sms/sms-adapter.interface';
import { OrderActorRole } from '../orders/order-status.enum';

describe('AuthService', () => {
  let service: AuthService;
  let userModel: any;
  let otpModel: any;
  let refreshTokenModel: any;
  let jwtService: any;
  let configService: any;
  let smsAdapter: any;

  const mockUserId = new Types.ObjectId();
  const mockUser = {
    _id: mockUserId,
    phone: '+919876543210',
    name: 'Test Customer',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
  };

  beforeEach(async () => {
    userModel = {
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
    };

    otpModel = {
      countDocuments: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
    };

    refreshTokenModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
    };

    jwtService = {
      sign: jest.fn().mockReturnValue('mock.jwt.access_token'),
    };

    configService = {
      get: jest.fn((key: string) => {
        if (key === 'nodeEnv') return 'test';
        if (key === 'jwt.secret') return 'test_secret';
        return null;
      }),
    };

    smsAdapter = {
      sendOtp: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(OtpCode.name), useValue: otpModel },
        { provide: getModelToken(RefreshToken.name), useValue: refreshTokenModel },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: SMS_ADAPTER, useValue: smsAdapter },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('requestOtp', () => {
    it('should generate and send OTP when under the rate limit', async () => {
      otpModel.countDocuments.mockResolvedValue(1);
      otpModel.updateMany.mockResolvedValue({ acknowledged: true });
      otpModel.create.mockResolvedValue({});

      const result = await service.requestOtp('+919876543210');

      expect(result.success).toBe(true);
      expect(result.expiresInSeconds).toBe(600);
      expect(otpModel.countDocuments).toHaveBeenCalledWith({
        phone: '+919876543210',
        createdAt: { $gte: expect.any(Date) },
      });
      expect(otpModel.updateMany).toHaveBeenCalledWith(
        { phone: '+919876543210', verified: false },
        { $set: { verified: true } },
      );
      expect(otpModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+919876543210',
          code: expect.any(String),
          verified: false,
        }),
      );
      expect(smsAdapter.sendOtp).toHaveBeenCalledWith('+919876543210', expect.any(String));
    });

    it('should throw 429 TOO_MANY_REQUESTS when rate limit (>= 3 in 10 mins) is exceeded', async () => {
      otpModel.countDocuments.mockResolvedValue(3);

      await expect(service.requestOtp('+919876543210')).rejects.toThrow(
        expect.objectContaining({
          status: HttpStatus.TOO_MANY_REQUESTS,
        }),
      );
      expect(smsAdapter.sendOtp).not.toHaveBeenCalled();
    });
  });

  describe('verifyOtp', () => {
    it('should throw BadRequestException if no valid OTP document is found', async () => {
      otpModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(null),
      });

      await expect(service.verifyOtp('+919876543210', '123456')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject invalid code and increment attempt counter', async () => {
      const mockOtpDoc = {
        code: '123456',
        attempts: 1,
        verified: false,
        save: jest.fn().mockResolvedValue(true),
      };

      otpModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockOtpDoc),
      });

      await expect(service.verifyOtp('+919876543210', '999999')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockOtpDoc.attempts).toBe(2);
      expect(mockOtpDoc.save).toHaveBeenCalled();
    });

    it('should invalidate OTP and throw if max attempts (>3) exceeded', async () => {
      const mockOtpDoc = {
        code: '123456',
        attempts: 3,
        verified: false,
        save: jest.fn().mockResolvedValue(true),
      };

      otpModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockOtpDoc),
      });

      await expect(service.verifyOtp('+919876543210', '123456')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockOtpDoc.attempts).toBe(4);
      expect(mockOtpDoc.verified).toBe(true);
      expect(mockOtpDoc.save).toHaveBeenCalled();
    });

    it('should authenticate existing user and issue access and refresh tokens upon valid OTP', async () => {
      const mockOtpDoc = {
        code: '123456',
        attempts: 0,
        verified: false,
        save: jest.fn().mockResolvedValue(true),
      };

      otpModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockOtpDoc),
      });
      userModel.findOne.mockResolvedValue(mockUser);
      refreshTokenModel.create.mockResolvedValue({});

      const result = await service.verifyOtp('+919876543210', '123456');

      expect(mockOtpDoc.verified).toBe(true);
      expect(mockOtpDoc.save).toHaveBeenCalled();
      expect(result.accessToken).toBe('mock.jwt.access_token');
      expect(result.refreshToken).toBeDefined();
      expect(result.user.id).toBe(mockUserId.toString());
      expect(result.user.isNewUser).toBe(false);
      expect(refreshTokenModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          revoked: false,
        }),
      );
    });

    it('should register new user if phone does not exist yet', async () => {
      const mockOtpDoc = {
        code: '123456',
        attempts: 0,
        verified: false,
        save: jest.fn().mockResolvedValue(true),
      };

      otpModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockOtpDoc),
      });
      userModel.findOne.mockResolvedValue(null);
      userModel.create.mockResolvedValue({
        _id: mockUserId,
        phone: '+919876543210',
        role: OrderActorRole.CUSTOMER,
        isActive: true,
      });
      refreshTokenModel.create.mockResolvedValue({});

      const result = await service.verifyOtp('+919876543210', '123456');

      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: '+919876543210',
          role: OrderActorRole.CUSTOMER,
        }),
      );
      expect(result.user.isNewUser).toBe(true);
    });
  });

  describe('refreshTokens', () => {
    it('should throw UnauthorizedException if refresh token is not found or revoked', async () => {
      refreshTokenModel.findOne.mockResolvedValue(null);

      await expect(service.refreshTokens('invalid_token')).rejects.toThrow(UnauthorizedException);
    });

    it('should rotate token: revoke old token and return new token pair', async () => {
      const mockStoredToken = {
        userId: mockUserId,
        tokenHash: 'hashed_token',
        revoked: false,
        save: jest.fn().mockResolvedValue(true),
      };

      refreshTokenModel.findOne.mockResolvedValue(mockStoredToken);
      userModel.findById.mockResolvedValue(mockUser);
      refreshTokenModel.create.mockResolvedValue({});

      const result = await service.refreshTokens('valid_raw_token');

      expect(mockStoredToken.revoked).toBe(true);
      expect(mockStoredToken.save).toHaveBeenCalled();
      expect(result.accessToken).toBe('mock.jwt.access_token');
      expect(result.refreshToken).toBeDefined();
      expect(refreshTokenModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: mockUserId,
          revoked: false,
        }),
      );
    });

    it('should throw UnauthorizedException if user is deactivated', async () => {
      const mockStoredToken = {
        userId: mockUserId,
        tokenHash: 'hashed_token',
        revoked: false,
        save: jest.fn().mockResolvedValue(true),
      };

      refreshTokenModel.findOne.mockResolvedValue(mockStoredToken);
      userModel.findById.mockResolvedValue({ ...mockUser, isActive: false });

      await expect(service.refreshTokens('valid_raw_token')).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('should revoke the refresh token hash', async () => {
      refreshTokenModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.logout('some_refresh_token');

      expect(result.success).toBe(true);
      expect(refreshTokenModel.updateOne).toHaveBeenCalledWith(
        { tokenHash: expect.any(String) },
        { $set: { revoked: true } },
      );
    });
  });
});
