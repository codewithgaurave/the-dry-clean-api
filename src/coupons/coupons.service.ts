import { Injectable, BadRequestException, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Coupon, CouponDocument, CouponDiscountType } from '../database/schemas/coupon.schema';
import { Booking, BookingDocument } from '../database/schemas/booking.schema';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { ValidateCouponResponseDto } from './dto/validate-coupon-response.dto';

/**
 * Service managing coupon validation, eligibility rules, discount calculations, and seeds.
 * Source of truth: PRD.md §6.5 (FR-PR-3, FR-PR-4), §10; TECH_STACK.md §7.2; TODO.md TASK-023.
 */
@Injectable()
export class CouponsService implements OnModuleInit {
  private readonly logger = new Logger(CouponsService.name);

  constructor(
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
  ) {}

  async onModuleInit() {
    await this.seedInitialCoupons();
  }

  /**
   * Authoritatively validates coupon eligibility, expiration, min order value,
   * category restrictions, and usage limits. Returns calculated discount minor and formatted values.
   *
   * @param dto ValidateCouponDto containing code, subtotal, categories, and optional userId
   * @param now Optional reference time for deterministic testing
   */
  async validateCoupon(
    dto: ValidateCouponDto,
    now: Date = new Date(),
  ): Promise<ValidateCouponResponseDto> {
    if (!dto.code || dto.code.trim().length === 0) {
      throw new BadRequestException('Coupon code is required');
    }

    const normalizedCode = dto.code.trim().toUpperCase();

    // 1. Find coupon by code
    const coupon = await this.couponModel.findOne({ code: normalizedCode });
    if (!coupon) {
      throw new BadRequestException(`Invalid coupon code "${normalizedCode}".`);
    }

    // 2. Check active flag
    if (!coupon.active) {
      throw new BadRequestException(`Coupon "${normalizedCode}" is currently inactive.`);
    }

    // 3. Check expiration
    if (coupon.validUntil && coupon.validUntil.getTime() < now.getTime()) {
      throw new BadRequestException(`Coupon "${normalizedCode}" has expired.`);
    }

    // 4. Check minimum order value threshold
    if (dto.subtotalMinor < coupon.minOrderValueMinor) {
      const minOrderFormatted = this.formatCurrency(coupon.minOrderValueMinor);
      throw new BadRequestException(
        `Minimum order value of ${minOrderFormatted} required for coupon "${normalizedCode}".`,
      );
    }

    // 5. Check category restrictions
    if (coupon.applicableCategories && coupon.applicableCategories.length > 0) {
      if (!dto.categories || dto.categories.length === 0) {
        throw new BadRequestException(
          `Coupon "${normalizedCode}" is only applicable to categories: ${coupon.applicableCategories.join(', ')}.`,
        );
      }

      const orderCategoriesUpper = dto.categories.map((c) => c.toUpperCase());
      const hasMatchingCategory = coupon.applicableCategories.some((cat) =>
        orderCategoriesUpper.includes(cat.toUpperCase()),
      );

      if (!hasMatchingCategory) {
        throw new BadRequestException(
          `Coupon "${normalizedCode}" is only applicable to categories: ${coupon.applicableCategories.join(', ')}.`,
        );
      }
    }

    // 6. Check global redemption limit
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
      throw new BadRequestException(
        `Coupon "${normalizedCode}" has reached its maximum redemption limit.`,
      );
    }

    // 7. Check per-user redemption limit
    if (dto.userId && coupon.perUserLimit != null) {
      if (Types.ObjectId.isValid(dto.userId)) {
        const userRedemptions = await this.bookingModel.countDocuments({
          userId: new Types.ObjectId(dto.userId),
          couponCode: normalizedCode,
          status: { $ne: 'CANCELLED' },
        });

        if (userRedemptions >= coupon.perUserLimit) {
          throw new BadRequestException(
            `You have already used coupon "${normalizedCode}" the maximum allowed times.`,
          );
        }
      }
    }

    // 8. Calculate discount amount in minor integer units (paise)
    let discountMinor = 0;
    if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      const rawDiscount = Math.round((dto.subtotalMinor * coupon.discountValue) / 100);
      discountMinor = coupon.maxDiscountMinor
        ? Math.min(rawDiscount, coupon.maxDiscountMinor)
        : rawDiscount;
    } else {
      discountMinor = Math.min(coupon.discountValue, dto.subtotalMinor);
    }

    const newSubtotalMinor = Math.max(0, dto.subtotalMinor - discountMinor);
    const discountFormatted = this.formatCurrency(discountMinor);
    const newSubtotalFormatted = this.formatCurrency(newSubtotalMinor);

    return {
      isValid: true,
      code: coupon.code,
      title: coupon.title,
      description: coupon.description,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      maxDiscountMinor: coupon.maxDiscountMinor,
      discountMinor,
      discountFormatted,
      newSubtotalMinor,
      newSubtotalFormatted,
      message: `Coupon "${coupon.code}" applied! You save ${discountFormatted}.`,
    };
  }

  /**
   * Retrieves all active coupons for client promotion lists.
   */
  async listActiveCoupons(category?: string): Promise<CouponDocument[]> {
    const query: any = { active: true };
    const now = new Date();
    query.$or = [{ validUntil: { $exists: false } }, { validUntil: { $gt: now } }];

    const coupons = await this.couponModel.find(query).sort({ minOrderValueMinor: 1 });

    if (category) {
      return coupons.filter((c) => {
        if (!c.applicableCategories || c.applicableCategories.length === 0) return true;
        return c.applicableCategories.some((cat) => cat.toUpperCase() === category.toUpperCase());
      });
    }

    return coupons;
  }

  /**
   * Atomically records coupon redemption incrementing usedCount.
   */
  async recordCouponUsage(code: string): Promise<void> {
    const normalizedCode = code.trim().toUpperCase();
    await this.couponModel.updateOne({ code: normalizedCode }, { $inc: { usedCount: 1 } });
  }

  /**
   * Formats paise minor integers into Indian Rupee strings (₹XX.XX).
   */
  public formatCurrency(paise: number): string {
    const major = (paise / 100).toFixed(2);
    return `₹${major}`;
  }

  /**
   * Seeds standard promotional coupons if not already present.
   */
  async seedInitialCoupons(): Promise<void> {
    try {
      const count = await this.couponModel.countDocuments();
      if (count > 0) return;

      this.logger.log('Seeding initial promotional coupons...');
      const defaultCoupons = [
        {
          code: 'WELCOME10',
          title: 'Welcome 10% Off',
          description: '10% off on your first atelier dry cleaning order (up to ₹150)',
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 10,
          maxDiscountMinor: 15000, // ₹150.00
          minOrderValueMinor: 30000, // ₹300.00
          active: true,
          applicableCategories: [],
          usageLimit: 1000,
          usedCount: 0,
          perUserLimit: 1,
        },
        {
          code: 'ATELIER50',
          title: 'Atelier Care ₹50 Off',
          description: 'Flat ₹50 savings on any service above ₹400',
          discountType: CouponDiscountType.FLAT,
          discountValue: 5000, // ₹50.00
          minOrderValueMinor: 40000, // ₹400.00
          active: true,
          applicableCategories: [],
          usageLimit: 1000,
          usedCount: 0,
          perUserLimit: 2,
        },
        {
          code: 'FLAT100',
          title: 'Flat ₹100 Savings',
          description: 'Flat ₹100 off on premium orders above ₹500',
          discountType: CouponDiscountType.FLAT,
          discountValue: 10000, // ₹100.00
          minOrderValueMinor: 50000, // ₹500.00
          active: true,
          applicableCategories: [],
          usageLimit: 500,
          usedCount: 0,
          perUserLimit: 1,
        },
        {
          code: 'DRYCLEAN15',
          title: 'Dry Cleaning Special 15%',
          description: '15% off exclusively on Dry Cleaning category up to ₹200',
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 15,
          maxDiscountMinor: 20000, // ₹200.00
          minOrderValueMinor: 40000, // ₹400.00
          active: true,
          applicableCategories: ['DRY_CLEAN'],
          usageLimit: 500,
          usedCount: 0,
          perUserLimit: 1,
        },
      ];

      for (const couponData of defaultCoupons) {
        await this.couponModel.create(couponData);
      }
      this.logger.log(`Seeded ${defaultCoupons.length} promotional coupons.`);
    } catch (err: any) {
      this.logger.error(`Failed to seed initial coupons: ${err.message}`, err.stack);
    }
  }
}
