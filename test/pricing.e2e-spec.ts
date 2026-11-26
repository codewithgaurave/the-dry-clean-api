import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PricingController } from '../src/pricing/pricing.controller';
import { PricingService } from '../src/pricing/pricing.service';
import { Service, ServicePrice } from '../src/database/schemas/service.schema';
import { Coupon, CouponDiscountType } from '../src/database/schemas/coupon.schema';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('PricingController (e2e)', () => {
  let app: INestApplication;
  let serviceModel: any;
  let servicePriceModel: any;
  let couponModel: any;

  const mockServiceId = new Types.ObjectId();
  const mockService = {
    _id: mockServiceId,
    name: 'Dry Cleaning',
    active: true,
  };

  const mockPriceDoc = {
    _id: new Types.ObjectId(),
    serviceId: mockServiceId,
    itemType: "Men's Suit (2-Piece)",
    amountMinor: 35000, // ₹350.00
    unit: 'piece',
    package: 'Standard',
    active: true,
  };

  beforeAll(async () => {
    serviceModel = {
      findOne: jest.fn(),
    };

    servicePriceModel = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    couponModel = {
      findOne: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(1),
      create: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PricingController],
      providers: [
        PricingService,
        { provide: getModelToken(Service.name), useValue: serviceModel },
        { provide: getModelToken(ServicePrice.name), useValue: servicePriceModel },
        { provide: getModelToken(Coupon.name), useValue: couponModel },
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /v1/pricing/quote', () => {
    it('returns 200 with complete itemized quote and 18% GST', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockService),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockPriceDoc),
      });

      const res = await request(app.getHttpServer())
        .post('/v1/pricing/quote')
        .send({
          items: [
            {
              serviceId: mockServiceId.toString(),
              itemType: "Men's Suit (2-Piece)",
              quantity: 1,
            },
          ],
        })
        .expect(HttpStatus.OK);

      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('breakdown');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].unitPriceMinor).toBe(35000);
      expect(res.body.breakdown.itemsSubtotalMinor).toBe(35000);
      expect(res.body.breakdown.deliveryFeeMinor).toBe(5000);
      expect(res.body.breakdown.gstMinor).toBe(6300);
      expect(res.body.breakdown.totalAmountMinor).toBe(46300);
      expect(res.body.breakdown.totalAmountFormatted).toBe('₹463.00');
    });

    it('supports alias endpoint POST /v1/bookings/quote for booking flow', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockService),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockPriceDoc),
      });

      const res = await request(app.getHttpServer())
        .post('/v1/bookings/quote')
        .send({
          items: [
            {
              serviceId: mockServiceId.toString(),
              itemType: "Men's Suit (2-Piece)",
              quantity: 1,
            },
          ],
        })
        .expect(HttpStatus.OK);

      expect(res.body.breakdown.totalAmountMinor).toBe(46300);
    });

    it('returns 200 with verified coupon discount applied', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockService),
      });

      servicePriceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockPriceDoc),
      });

      couponModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          code: 'WELCOME10',
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 10,
          maxDiscountMinor: 15000,
          minOrderValueMinor: 30000,
          active: true,
        }),
      });

      const res = await request(app.getHttpServer())
        .post('/v1/pricing/quote')
        .send({
          items: [
            {
              serviceId: mockServiceId.toString(),
              itemType: "Men's Suit (2-Piece)",
              quantity: 1,
            },
          ],
          couponCode: 'welcome10',
        })
        .expect(HttpStatus.OK);

      expect(res.body.breakdown.couponApplied).toBe(true);
      expect(res.body.breakdown.discountMinor).toBe(3500); // 10% of ₹350 = ₹35.00
      expect(res.body.breakdown.taxableAmountMinor).toBe(31500);
    });

    it('rejects empty items payload with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/v1/pricing/quote')
        .send({ items: [] })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('rejects invalid serviceId format with 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/v1/pricing/quote')
        .send({
          items: [
            {
              serviceId: 'non-objectid',
              itemType: "Men's Suit (2-Piece)",
              quantity: 1,
            },
          ],
        })
        .expect(HttpStatus.BAD_REQUEST);
    });
  });
});
