import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import { Coupon, CouponSchema } from '../database/schemas/coupon.schema';
import { Booking, BookingSchema } from '../database/schemas/booking.schema';

/**
 * Promotional Coupons & Offers Module.
 * Source of truth: PRD.md §6.5 (FR-PR-3, FR-PR-4), §10; TECH_STACK.md §6.4, §7.2; TODO.md TASK-023.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Coupon.name, schema: CouponSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [CouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
