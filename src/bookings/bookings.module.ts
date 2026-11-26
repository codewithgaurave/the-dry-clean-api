import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { Booking, BookingSchema } from '../database/schemas/booking.schema';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import {
  OrderStatusEvent,
  OrderStatusEventSchema,
} from '../database/schemas/order-status-event.schema';
import { DeliveryTask, DeliveryTaskSchema } from '../database/schemas/delivery-task.schema';
import { Address, AddressSchema } from '../database/schemas/address.schema';
import {
  Service,
  ServiceSchema,
  ServicePrice,
  ServicePriceSchema,
} from '../database/schemas/service.schema';
import {
  IdempotencyRecord,
  IdempotencyRecordSchema,
} from '../database/schemas/idempotency-record.schema';
import { SlotsModule } from '../slots/slots.module';
import { CouponsModule } from '../coupons/coupons.module';

/**
 * Bookings Module.
 * Source of truth: PRD.md §6.4 (FR-BK-7, FR-BK-8, FR-BK-9); TECH_STACK.md §7.2, §8.3; TODO.md TASK-024.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Order.name, schema: OrderSchema },
      { name: OrderStatusEvent.name, schema: OrderStatusEventSchema },
      { name: DeliveryTask.name, schema: DeliveryTaskSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: ServicePrice.name, schema: ServicePriceSchema },
      { name: IdempotencyRecord.name, schema: IdempotencyRecordSchema },
    ]),
    SlotsModule,
    CouponsModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
