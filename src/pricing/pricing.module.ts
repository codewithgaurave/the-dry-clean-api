import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Service,
  ServiceSchema,
  ServicePrice,
  ServicePriceSchema,
} from '../database/schemas/service.schema';
import { Coupon, CouponSchema } from '../database/schemas/coupon.schema';
import { PricingService } from './pricing.service';
import { PricingController } from './pricing.controller';

/**
 * Pricing Module.
 * Source of truth: PRD.md §6.5; TECH_STACK.md §7.2; TODO.md TASK-018.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Service.name, schema: ServiceSchema },
      { name: ServicePrice.name, schema: ServicePriceSchema },
      { name: Coupon.name, schema: CouponSchema },
    ]),
  ],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
