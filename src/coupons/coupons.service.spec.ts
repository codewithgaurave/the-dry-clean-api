import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { CouponsService } from './coupons.service';
import { Coupon, CouponDiscountType } from '../database/schemas/coupon.schema';
import { Booking } from '../database/schemas/booking.schema';

describe('CouponsService', () => {
  let service: CouponsService;
  let couponModel: any;
  let bookingModel: any;

  const mockWelcomeCoupon = {
    code: 'WELCOME10',
    title: 'Welcome 10% Off',
    discountType: CouponDiscountType.PERCENTAGE,
    discountValue: 10,
    maxDiscountMinor: 15000, // ₹150.00
    minOrderValueMinor: 30000, // ₹300.00
    active: true,
    applicableCategories: [],
    usageLimit: 1000,
    usedCount: 5,
    perUserLimit: 1,
  };

  const mockFlatCoupon = {
    code: 'FLAT100',
    title: 'Flat ₹100 Off',
    discountType: CouponDiscountType.FLAT,
    discountValue: 10000, // ₹100.00
    minOrderValueMinor: 50000, // ₹500.00
    active: true,
    applicableCategories: [],
    usageLimit: 500,
    usedCount: 10,
    perUserLimit: 1,
  };

  const mockCategoryCoupon = {
    code: 'DRYCLEAN15',
    title: 'Dry Cleaning 15% Off',
    discountType: CouponDiscountType.PERCENTAGE,
    discountValue: 15,
    maxDiscountMinor: 20000, // ₹200.00
    minOrderValueMinor: 40000, // ₹400.00
    active: true,
    applicableCategories: ['DRY_CLEAN'],
    usageLimit: 100,
    usedCount: 0,
    perUserLimit: 1,
  };

  beforeEach(async () => {
    couponModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(1),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      create: jest.fn(),
    };

    bookingModel = {
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    const module: TestingModule = await Test.createTestingModule({
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

    service = module.get<CouponsService>(CouponsService);
  });

  describe('Percentage discount calculation', () => {
    it('applies percentage discount below maxDiscount cap', async () => {
      couponModel.findOne.mockResolvedValue(mockWelcomeCoupon);

      // Subtotal ₹700 (70000 paise). 10% = 7000 paise (₹70.00). Max cap = ₹150.
      const res = await service.validateCoupon({
        code: 'welcome10',
        subtotalMinor: 70000,
      });

      expect(res.isValid).toBe(true);
      expect(res.code).toBe('WELCOME10');
      expect(res.discountMinor).toBe(7000);
      expect(res.discountFormatted).toBe('₹70.00');
      expect(res.newSubtotalMinor).toBe(63000);
      expect(res.newSubtotalFormatted).toBe('₹630.00');
    });

    it('caps percentage discount at maxDiscountMinor when exceeded', async () => {
      couponModel.findOne.mockResolvedValue(mockWelcomeCoupon);

      // Subtotal ₹2000 (200000 paise). 10% = 20000 paise (₹200.00). Capped at 15000 paise (₹150.00).
      const res = await service.validateCoupon({
        code: 'WELCOME10',
        subtotalMinor: 200000,
      });

      expect(res.isValid).toBe(true);
      expect(res.discountMinor).toBe(15000);
      expect(res.discountFormatted).toBe('₹150.00');
      expect(res.newSubtotalMinor).toBe(185000);
    });
  });

  describe('Flat discount calculation', () => {
    it('applies flat discount accurately', async () => {
      couponModel.findOne.mockResolvedValue(mockFlatCoupon);

      // Subtotal ₹800 (80000 paise). FLAT100 = 10000 paise.
      const res = await service.validateCoupon({
        code: 'FLAT100',
        subtotalMinor: 80000,
      });

      expect(res.isValid).toBe(true);
      expect(res.discountMinor).toBe(10000);
      expect(res.discountFormatted).toBe('₹100.00');
      expect(res.newSubtotalMinor).toBe(70000);
      expect(res.newSubtotalFormatted).toBe('₹700.00');
    });
  });

  describe('Rejection criteria (400 Bad Request)', () => {
    it('rejects invalid or non-existent coupon code', async () => {
      couponModel.findOne.mockResolvedValue(null);

      await expect(
        service.validateCoupon({
          code: 'NOTEXIST',
          subtotalMinor: 50000,
        }),
      ).rejects.toThrow(new BadRequestException('Invalid coupon code "NOTEXIST".'));
    });

    it('rejects inactive coupon code', async () => {
      couponModel.findOne.mockResolvedValue({
        ...mockWelcomeCoupon,
        active: false,
      });

      await expect(
        service.validateCoupon({
          code: 'WELCOME10',
          subtotalMinor: 50000,
        }),
      ).rejects.toThrow(new BadRequestException('Coupon "WELCOME10" is currently inactive.'));
    });

    it('rejects expired coupon code', async () => {
      const pastDate = new Date('2025-01-01');
      couponModel.findOne.mockResolvedValue({
        ...mockWelcomeCoupon,
        validUntil: pastDate,
      });

      const futureNow = new Date('2026-11-01');
      await expect(
        service.validateCoupon(
          {
            code: 'WELCOME10',
            subtotalMinor: 50000,
          },
          futureNow,
        ),
      ).rejects.toThrow(new BadRequestException('Coupon "WELCOME10" has expired.'));
    });

    it('rejects when order subtotal is below minimum order value threshold', async () => {
      couponModel.findOne.mockResolvedValue(mockFlatCoupon);

      // FLAT100 requires min order ₹500 (50000 paise). Subtotal is ₹350 (35000 paise).
      await expect(
        service.validateCoupon({
          code: 'FLAT100',
          subtotalMinor: 35000,
        }),
      ).rejects.toThrow(
        new BadRequestException('Minimum order value of ₹500.00 required for coupon "FLAT100".'),
      );
    });

    it('rejects when category restrictions are not satisfied', async () => {
      couponModel.findOne.mockResolvedValue(mockCategoryCoupon);

      // DRYCLEAN15 requires DRY_CLEAN. Order only has WASH_FOLD.
      await expect(
        service.validateCoupon({
          code: 'DRYCLEAN15',
          subtotalMinor: 50000,
          categories: ['WASH_FOLD'],
        }),
      ).rejects.toThrow(
        new BadRequestException('Coupon "DRYCLEAN15" is only applicable to categories: DRY_CLEAN.'),
      );
    });

    it('accepts when matching category is present in order categories', async () => {
      couponModel.findOne.mockResolvedValue(mockCategoryCoupon);

      const res = await service.validateCoupon({
        code: 'DRYCLEAN15',
        subtotalMinor: 50000,
        categories: ['WASH_FOLD', 'dry_clean'], // Case-insensitive match
      });

      expect(res.isValid).toBe(true);
      expect(res.discountMinor).toBe(7500); // 15% of 50000
    });

    it('rejects when global usage limit has been reached', async () => {
      couponModel.findOne.mockResolvedValue({
        ...mockWelcomeCoupon,
        usageLimit: 100,
        usedCount: 100, // Saturation reached
      });

      await expect(
        service.validateCoupon({
          code: 'WELCOME10',
          subtotalMinor: 50000,
        }),
      ).rejects.toThrow(
        new BadRequestException('Coupon "WELCOME10" has reached its maximum redemption limit.'),
      );
    });

    it('rejects when per-user usage limit has been reached', async () => {
      couponModel.findOne.mockResolvedValue({
        ...mockWelcomeCoupon,
        perUserLimit: 1,
      });

      // User already has 1 confirmed booking with WELCOME10
      bookingModel.countDocuments.mockResolvedValue(1);

      const userId = new Types.ObjectId().toString();
      await expect(
        service.validateCoupon({
          code: 'WELCOME10',
          subtotalMinor: 50000,
          userId,
        }),
      ).rejects.toThrow(
        new BadRequestException(
          'You have already used coupon "WELCOME10" the maximum allowed times.',
        ),
      );
    });
  });

  describe('Coupon management helpers', () => {
    it('recordCouponUsage increments usedCount', async () => {
      await service.recordCouponUsage('welcome10');
      expect(couponModel.updateOne).toHaveBeenCalledWith(
        { code: 'WELCOME10' },
        { $inc: { usedCount: 1 } },
      );
    });
  });
});
