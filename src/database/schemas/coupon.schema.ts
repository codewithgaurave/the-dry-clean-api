import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type CouponDocument = Coupon & Document;

export enum CouponDiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FLAT = 'FLAT',
}

/**
 * Coupon & Promotional Offer Schema.
 * Source of truth: PRD.md §6.5, §9.1; TECH_STACK.md §7.2.
 */
@Schema({ timestamps: true, collection: 'coupons' })
export class Coupon {
  @Prop({ required: true, unique: true, uppercase: true, trim: true, index: true })
  code: string; // e.g. "WELCOME10", "ATELIER50", "FLAT100"

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ trim: true })
  description?: string;

  @Prop({
    required: true,
    enum: [CouponDiscountType.PERCENTAGE, CouponDiscountType.FLAT],
  })
  discountType: CouponDiscountType;

  @Prop({ required: true })
  discountValue: number; // e.g. 10 for 10%, or 10000 for ₹100 flat

  @Prop()
  maxDiscountMinor?: number; // e.g. 15000 for ₹150 cap

  @Prop({ default: 0 })
  minOrderValueMinor: number; // e.g. 50000 for ₹500 minimum

  @Prop({ default: true, index: true })
  active: boolean;

  @Prop()
  validUntil?: Date;

  @Prop({ type: [String], default: [] })
  applicableCategories?: string[]; // e.g. ['DRY_CLEAN'] or empty for all categories

  @Prop({ default: 1000, min: 0 })
  usageLimit?: number; // Total redemptions allowed across all users

  @Prop({ default: 0, min: 0 })
  usedCount: number; // Current redemption count

  @Prop({ default: 1, min: 1 })
  perUserLimit?: number; // Max redemptions allowed per customer

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CouponSchema = SchemaFactory.createForClass(Coupon);
