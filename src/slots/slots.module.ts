import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SlotsController } from './slots.controller';
import { SlotsService } from './slots.service';
import { PickupSlot, PickupSlotSchema } from '../database/schemas/pickup-slot.schema';
import { Booking, BookingSchema } from '../database/schemas/booking.schema';

/**
 * Pickup Slots & Availability Module.
 * Source of truth: PRD.md §6.4 (FR-BK-4); TECH_STACK.md §6.4, §7.2; TODO.md TASK-021.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PickupSlot.name, schema: PickupSlotSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [SlotsController],
  providers: [SlotsService],
  exports: [SlotsService],
})
export class SlotsModule {}
