import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/database/schemas/user.schema';
import { OtpCode } from '../src/database/schemas/otp-code.schema';
import { RefreshToken } from '../src/database/schemas/refresh-token.schema';
import { SMS_ADAPTER } from '../src/auth/sms/sms-adapter.interface';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { OrderActorRole } from '../src/orders/order-status.enum';

describe('AuthController (e2e)', () => {
  let app: INestApplication;
  let userModel: any;
  let otpModel: any;
  let refreshTokenModel: any;
  let smsAdapter: any;

  const mockUserId = new Types.ObjectId();
  const mockUser = {
    _id: mockUserId,
    phone: '+919876543210',
    name: 'Atelier Customer',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
  };

  beforeAll(async () => {
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

    smsAdapter = {
      sendOtp: jest.fn().mockResolvedValue(true),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              nodeEnv: 'test',
              jwt: {
                secret: 'atelier_test_secret_key',
                expiresIn: '15m',
              },
            }),
          ],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'atelier_test_secret_key',
          signOptions: { expiresIn: '15m' },
        }),
      ],
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(OtpCode.name), useValue: otpModel },
        { provide: getModelToken(RefreshToken.name), useValue: refreshTokenModel },
        { provide: SMS_ADAPTER, useValue: smsAdapter },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('POST /v1/auth/otp/request', () => {
    it('returns 200 with valid phone number', async () => {
      otpModel.countDocuments.mockResolvedValue(0);
      otpModel.updateMany.mockResolvedValue({ acknowledged: true });
      otpModel.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: '+919876543210' })
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.expiresInSeconds).toBe(600);
      expect(smsAdapter.sendOtp).toHaveBeenCalledWith('+919876543210', expect.any(String));
    });

    it('returns 400 for invalid phone number format', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: 'invalid-phone' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
    });

    it('returns 429 when OTP rate limit exceeded', async () => {
      otpModel.countDocuments.mockResolvedValue(3);

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/request')
        .send({ phone: '+919876543210' })
        .expect(HttpStatus.TOO_MANY_REQUESTS);

      expect(res.body.statusCode).toBe(429);
      expect(res.body.errorCode).toBe('RATE_LIMIT_EXCEEDED');
    });
  });

  describe('POST /v1/auth/otp/verify', () => {
    it('returns 200 with tokens and user info on valid OTP', async () => {
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

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ phone: '+919876543210', otp: '123456' })
        .expect(HttpStatus.OK);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.expiresIn).toBe(900);
      expect(res.body.user.phone).toBe('+919876543210');
      expect(res.body.user.role).toBe(OrderActorRole.CUSTOMER);
    });

    it('returns 400 when OTP is incorrect', async () => {
      const mockOtpDoc = {
        code: '123456',
        attempts: 0,
        verified: false,
        save: jest.fn().mockResolvedValue(true),
      };

      otpModel.findOne.mockReturnValue({
        sort: jest.fn().mockResolvedValue(mockOtpDoc),
      });

      const res = await request(app.getHttpServer())
        .post('/v1/auth/otp/verify')
        .send({ phone: '+919876543210', otp: '654321' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
    });
  });

  describe('POST /v1/auth/refresh', () => {
    it('returns new tokens on valid refresh token', async () => {
      const mockStoredToken = {
        userId: mockUserId,
        tokenHash: 'mock_hash',
        revoked: false,
        save: jest.fn().mockResolvedValue(true),
      };

      refreshTokenModel.findOne.mockResolvedValue(mockStoredToken);
      userModel.findById.mockResolvedValue(mockUser);
      refreshTokenModel.create.mockResolvedValue({});

      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'sample_refresh_token_123456' })
        .expect(HttpStatus.OK);

      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.expiresIn).toBe(900);
      expect(mockStoredToken.revoked).toBe(true);
    });

    it('returns 401 when refresh token is invalid or expired', async () => {
      refreshTokenModel.findOne.mockResolvedValue(null);

      const res = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: 'invalid_or_expired_token' })
        .expect(HttpStatus.UNAUTHORIZED);

      expect(res.body.statusCode).toBe(401);
    });
  });

  describe('POST /v1/auth/logout', () => {
    it('returns 200 and revokes token', async () => {
      refreshTokenModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const res = await request(app.getHttpServer())
        .post('/v1/auth/logout')
        .send({ refreshToken: 'active_refresh_token_abc' })
        .expect(HttpStatus.OK);

      expect(res.body.success).toBe(true);
      expect(refreshTokenModel.updateOne).toHaveBeenCalledWith(
        { tokenHash: expect.any(String) },
        { $set: { revoked: true } },
      );
    });
  });
});
