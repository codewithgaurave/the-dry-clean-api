import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Service,
  ServiceDocument,
  ServicePrice,
  ServicePriceDocument,
} from '../database/schemas/service.schema';
import { Coupon, CouponDocument, CouponDiscountType } from '../database/schemas/coupon.schema';
import { QuoteRequestDto, QuoteItemDto } from './dto/quote-request.dto';
import {
  QuoteResponseDto,
  QuoteItemResponse,
  QuoteAddonResponse,
  QuoteBreakdown,
} from './dto/quote-response.dto';

/**
 * Server-Side Quotation & Pricing Engine.
 * Enforces server-authoritative line item arithmetic, GST tax calculations (18%),
 * delivery thresholds, and coupon validation in minor integer units.
 * Source of truth: PRD.md §6.5; TECH_STACK.md §7.2; TODO.md TASK-018.
 */
@Injectable()
export class PricingService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PricingService.name);

  // Business Constants (minor units / paise)
  public static readonly GST_RATE = 18; // 18% GST (9% CGST + 9% SGST)
  public static readonly STANDARD_DELIVERY_FEE_MINOR = 5000; // ₹50.00
  public static readonly FREE_DELIVERY_THRESHOLD_MINOR = 50000; // Free for orders >= ₹500.00
  public static readonly CURRENCY = 'INR';

  constructor(
    @InjectModel(Service.name)
    private readonly serviceModel: Model<ServiceDocument>,
    @InjectModel(ServicePrice.name)
    private readonly servicePriceModel: Model<ServicePriceDocument>,
    @InjectModel(Coupon.name)
    private readonly couponModel: Model<CouponDocument>,
  ) {}

  async onApplicationBootstrap() {
    await this.seedInitialCoupons();
  }

  /**
   * Calculate a verified quotation from client line items.
   * Line item rates are strictly resolved from authoritative ServicePrice records.
   */
  async calculateQuote(dto: QuoteRequestDto): Promise<QuoteResponseDto> {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one line item is required to generate a quotation.');
    }

    const verifiedItems: QuoteItemResponse[] = [];
    let itemsSubtotalMinor = 0;

    for (const itemDto of dto.items) {
      const verifiedItem = await this.resolveAndPriceItem(itemDto);
      verifiedItems.push(verifiedItem);
      itemsSubtotalMinor += verifiedItem.totalPriceMinor;
    }

    // --- Coupon & Discount Calculation ---
    let discountMinor = 0;
    let couponApplied = false;
    let couponMessage: string | undefined;
    let validatedCouponCode: string | undefined;

    if (dto.couponCode && dto.couponCode.trim().length > 0) {
      const normalizedCode = dto.couponCode.trim().toUpperCase();
      const couponResult = await this.applyCoupon(normalizedCode, itemsSubtotalMinor);
      discountMinor = couponResult.discountMinor;
      couponApplied = couponResult.couponApplied;
      couponMessage = couponResult.couponMessage;
      if (couponApplied) {
        validatedCouponCode = normalizedCode;
      }
    }

    // --- Delivery Fee Calculation ---
    const isDeliveryFree = itemsSubtotalMinor >= PricingService.FREE_DELIVERY_THRESHOLD_MINOR;
    const deliveryFeeMinor = isDeliveryFree ? 0 : PricingService.STANDARD_DELIVERY_FEE_MINOR;

    // --- Taxable Subtotal & GST Calculation (18%) ---
    const taxableAmountMinor = Math.max(0, itemsSubtotalMinor - discountMinor);
    const gstMinor = Math.round((taxableAmountMinor * PricingService.GST_RATE) / 100);
    const cgstMinor = Math.round(gstMinor / 2);
    const sgstMinor = gstMinor - cgstMinor;

    // --- Total Amount ---
    const totalAmountMinor = taxableAmountMinor + deliveryFeeMinor + gstMinor;

    const breakdown: QuoteBreakdown = {
      itemsSubtotalMinor,
      itemsSubtotalFormatted: this.formatCurrency(itemsSubtotalMinor),
      discountMinor,
      discountFormatted: this.formatCurrency(discountMinor),
      couponCode: validatedCouponCode,
      couponApplied,
      couponMessage,
      deliveryFeeMinor,
      deliveryFeeFormatted: isDeliveryFree ? 'FREE' : this.formatCurrency(deliveryFeeMinor),
      isDeliveryFree,
      taxableAmountMinor,
      taxableAmountFormatted: this.formatCurrency(taxableAmountMinor),
      gstRate: PricingService.GST_RATE,
      gstMinor,
      gstFormatted: this.formatCurrency(gstMinor),
      cgstMinor,
      sgstMinor,
      totalAmountMinor,
      totalAmountFormatted: this.formatCurrency(totalAmountMinor),
      currency: PricingService.CURRENCY,
    };

    return {
      items: verifiedItems,
      breakdown,
    };
  }

  /**
   * Resolve authoritative price and add-ons for a single item from the database.
   */
  private async resolveAndPriceItem(dto: QuoteItemDto): Promise<QuoteItemResponse> {
    if (!Types.ObjectId.isValid(dto.serviceId)) {
      throw new BadRequestException(`Invalid serviceId format: ${dto.serviceId}`);
    }

    const service = await this.serviceModel
      .findOne({
        _id: new Types.ObjectId(dto.serviceId),
        active: true,
      })
      .exec();

    if (!service) {
      throw new NotFoundException(`Active service not found with ID ${dto.serviceId}`);
    }

    // Look up matching price record
    const priceFilter: Record<string, any> = {
      serviceId: service._id,
      itemType: dto.itemType.trim(),
      active: true,
      isAddon: { $ne: true },
    };

    if (dto.package) {
      priceFilter.package = dto.package.trim();
    }

    let priceDoc = await this.servicePriceModel.findOne(priceFilter).exec();

    // Fallback: if package was specified but not found, check without package constraint
    if (!priceDoc && dto.package) {
      delete priceFilter.package;
      priceDoc = await this.servicePriceModel.findOne(priceFilter).exec();
    }

    if (!priceDoc) {
      throw new BadRequestException(
        `Authoritative pricing not configured for item "${dto.itemType}" under service "${service.name}".`,
      );
    }

    const unitPriceMinor = priceDoc.amountMinor;
    const baseTotalMinor = unitPriceMinor * dto.quantity;

    // Resolve Add-ons if provided
    const addons: QuoteAddonResponse[] = [];
    let addonsTotalMinor = 0;

    if (dto.addonIds && dto.addonIds.length > 0) {
      for (const addonId of dto.addonIds) {
        if (!Types.ObjectId.isValid(addonId)) continue;
        const addonDoc = await this.servicePriceModel
          .findOne({
            _id: new Types.ObjectId(addonId),
            active: true,
            isAddon: true,
          })
          .exec();

        if (addonDoc) {
          const addonItemTotal = addonDoc.amountMinor * dto.quantity;
          addonsTotalMinor += addonItemTotal;
          addons.push({
            id: addonDoc._id.toString(),
            itemType: addonDoc.itemType,
            unitPriceMinor: addonDoc.amountMinor,
            totalPriceMinor: addonItemTotal,
            amountFormatted: this.formatCurrency(addonItemTotal),
          });
        }
      }
    }

    const itemTotalMinor = baseTotalMinor + addonsTotalMinor;

    return {
      serviceId: service._id.toString(),
      serviceName: service.name,
      itemType: priceDoc.itemType,
      quantity: dto.quantity,
      package: priceDoc.package,
      unit: priceDoc.unit,
      unitPriceMinor,
      unitPriceFormatted: this.formatCurrency(unitPriceMinor),
      addons,
      totalPriceMinor: itemTotalMinor,
      totalPriceFormatted: this.formatCurrency(itemTotalMinor),
    };
  }

  /**
   * Validate coupon code and compute discount in minor integer units.
   */
  async applyCoupon(
    code: string,
    subtotalMinor: number,
  ): Promise<{ discountMinor: number; couponApplied: boolean; couponMessage: string }> {
    const coupon = await this.couponModel
      .findOne({
        code: code.toUpperCase().trim(),
        active: true,
      })
      .exec();

    if (!coupon) {
      return {
        discountMinor: 0,
        couponApplied: false,
        couponMessage: `Invalid or expired coupon code "${code}".`,
      };
    }

    if (coupon.validUntil && coupon.validUntil.getTime() < Date.now()) {
      return {
        discountMinor: 0,
        couponApplied: false,
        couponMessage: `Coupon "${code}" has expired.`,
      };
    }

    if (subtotalMinor < coupon.minOrderValueMinor) {
      const minOrderFormatted = this.formatCurrency(coupon.minOrderValueMinor);
      return {
        discountMinor: 0,
        couponApplied: false,
        couponMessage: `Minimum order value of ${minOrderFormatted} required for coupon "${code}".`,
      };
    }

    let discountMinor = 0;
    if (coupon.discountType === CouponDiscountType.PERCENTAGE) {
      const rawDiscount = Math.round((subtotalMinor * coupon.discountValue) / 100);
      discountMinor = coupon.maxDiscountMinor
        ? Math.min(rawDiscount, coupon.maxDiscountMinor)
        : rawDiscount;
    } else {
      discountMinor = Math.min(coupon.discountValue, subtotalMinor);
    }

    return {
      discountMinor,
      couponApplied: true,
      couponMessage: `Coupon "${coupon.code}" applied! You save ${this.formatCurrency(discountMinor)}.`,
    };
  }

  private formatCurrency(amountMinor: number): string {
    return `₹${(amountMinor / 100).toFixed(2)}`;
  }

  /**
   * Idempotent seed function for default promotional coupons.
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
          description: '10% off on your first order up to ₹150 for orders above ₹300',
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 10,
          maxDiscountMinor: 15000, // ₹150 cap
          minOrderValueMinor: 30000, // ₹300 min
          active: true,
        },
        {
          code: 'ATELIER50',
          title: 'Flat ₹50 Off',
          description: 'Flat ₹50 discount on orders above ₹250',
          discountType: CouponDiscountType.FLAT,
          discountValue: 5000, // ₹50 flat
          minOrderValueMinor: 25000, // ₹250 min
          active: true,
        },
        {
          code: 'FLAT100',
          title: 'Atelier Gold ₹100 Off',
          description: 'Flat ₹100 off on premium garment care orders above ₹500',
          discountType: CouponDiscountType.FLAT,
          discountValue: 10000, // ₹100 flat
          minOrderValueMinor: 50000, // ₹500 min
          active: true,
        },
        {
          code: 'PREMIUM20',
          title: 'Luxury Care 20% Off',
          description:
            '20% off on high-value couture dry cleaning up to ₹250 for orders above ₹600',
          discountType: CouponDiscountType.PERCENTAGE,
          discountValue: 20,
          maxDiscountMinor: 25000, // ₹250 cap
          minOrderValueMinor: 60000, // ₹600 min
          active: true,
        },
      ];

      for (const c of defaultCoupons) {
        await this.couponModel.create(c);
      }

      this.logger.log(`Seeded ${defaultCoupons.length} promotional coupons.`);
    } catch (err: any) {
      this.logger.error(`Failed to seed coupons: ${err.message}`, err.stack);
    }
  }
}
