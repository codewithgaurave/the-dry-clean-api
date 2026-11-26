import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { CouponsController } from '../src/coupons/coupons.controller';
import { CouponsService } from '../src/coupons/coupons.service';
import { Coupon, CouponDiscountType } from '../src/database/schemas/coupon.schema';
import { Booking } from '../src/database/schemas/booking.schema';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('CouponsController (e2e)', () => {
  let app: INestApplication;
  let couponModel: any;
  let bookingModel: any;

  const mockWelcomeCoupon = {
    _id: new Types.ObjectId(),
    code: 'WELCOME10',
    title: 'Welcome 10% Off',
    discountType: CouponDiscountType.PERCENTAGE,
    discountValue: 10,
    maxDiscountMinor: 15000, // ₹150.00
    minOrderValueMinor: 30000, // ₹300.00
    active: true,
    applicableCategories: [],
    usageLimit: 1000,
    usedCount: 0,
    perUserLimit: 1,
  };

  const mockFlatCoupon = {
    _id: new Types.ObjectId(),
    code: 'FLAT100',
    title: 'Flat ₹100 Off',
    discountType: CouponDiscountType.FLAT,
    discountValue: 10000, // ₹100.00
    minOrderValueMinor: 50000, // ₹500.00
    active: true,
    applicableCategories: [],
    usageLimit: 500,
    usedCount: 0,
    perUserLimit: 1,
  };

  const mockExpiredCoupon = {
    _id: new Types.ObjectId(),
    code: 'EXPIRED50',
    title: 'Old Coupon',
    discountType: CouponDiscountType.FLAT,
    discountValue: 5000,
    minOrderValueMinor: 10000,
    active: true,
    validUntil: new Date('2020-01-01'),
    usedCount: 0,
  };

  const mockDryCleanCoupon = {
    _id: new Types.ObjectId(),
    code: 'DRYCLEAN15',
    title: 'Dry Cleaning 15%',
    discountType: CouponDiscountType.PERCENTAGE,
    discountValue: 15,
    maxDiscountMinor: 20000,
    minOrderValueMinor: 40000,
    active: true,
    applicableCategories: ['DRY_CLEAN'],
    usedCount: 0,
  };

  beforeAll(async () => {
    couponModel = {
      findOne: jest.fn().mockImplementation((query: any) => {
        const code = query.code;
        if (code === 'WELCOME10') return Promise.resolve(mockWelcomeCoupon);
        if (code === 'FLAT100') return Promise.resolve(mockFlatCoupon);
        if (code === 'EXPIRED50') return Promise.resolve(mockExpiredCoupon);
        if (code === 'DRYCLEAN15') return Promise.resolve(mockDryCleanCoupon);
        return Promise.resolve(null);
      }),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockResolvedValue([mockWelcomeCoupon, mockFlatCoupon, mockDryCleanCoupon]),
      }),
      countDocuments: jest.fn().mockResolvedValue(4),
      create: jest.fn(),
      updateOne: jest.fn(),
    };

    bookingModel = {
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CouponsController],
      providers: [
        CouponsService,
        {
          provide: getModelToken(Coupon.name),
          useValue: couponModel,
        },
        {
          provide: getModelToken(Booking.name),
          useValue: bookingModel,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/coupons/validate', () => {
    it('should return 200 with discount details for valid percentage coupon', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/coupons/validate')
        .send({
          code: 'WELCOME10',
          subtotalMinor: 70000, // ₹700.00
        })
        .expect(HttpStatus.OK);

      expect(res.body.isValid).toBe(true);
      expect(res.body.code).toBe('WELCOME10');
      expect(res.body.discountMinor).toBe(7000); // 10% of 70000
      expect(res.body.discountFormatted).toBe('₹70.00');
      expect(res.body.newSubtotalMinor).toBe(63000);
      expect(res.body.newSubtotalFormatted).toBe('₹630.00');
    });

    it('should return 200 with discount details for valid flat discount coupon', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/coupons/validate')
        .send({
          code: 'FLAT100',
          subtotalMinor: 60000, // ₹600.00
        })
        .expect(HttpStatus.OK);

      expect(res.body.isValid).toBe(true);
      expect(res.body.code).toBe('FLAT100');
      expect(res.body.discountMinor).toBe(10000); // Flat ₹100.00
      expect(res.body.discountFormatted).toBe('₹100.00');
      expect(res.body.newSubtotalMinor).toBe(50000);
    });

    it('should return 400 Bad Request when coupon code does not exist', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/coupons/validate')
        .send({
          code: 'NONEXISTENT',
          subtotalMinor: 50000,
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Invalid coupon code/i);
    });

    it('should return 400 Bad Request when coupon has expired', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/coupons/validate')
        .send({
          code: 'EXPIRED50',
          subtotalMinor: 50000,
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toMatch(/has expired/i);
    });

    it('should return 400 Bad Request when subtotal is below minimum order value', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/coupons/validate')
        .send({
          code: 'FLAT100',
          subtotalMinor: 30000, // ₹300.00, below ₹500 required
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Minimum order value/i);
    });

    it('should return 400 Bad Request when category restriction is not satisfied', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/coupons/validate')
        .send({
          code: 'DRYCLEAN15',
          subtotalMinor: 50000,
          categories: ['WASH_FOLD'], // Does not have DRY_CLEAN
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toMatch(/only applicable to categories/i);
    });
  });

  describe('GET /v1/coupons', () => {
    it('should return list of available active promotional coupons', async () => {
      const res = await request(app.getHttpServer()).get('/v1/coupons').expect(HttpStatus.OK);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });
  });
});
