import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PickupSlotDocument = PickupSlot & Document;

export enum SlotKey {
  MORNING = 'MORNING',
  AFTERNOON = 'AFTERNOON',
  EVENING = 'EVENING',
}

/**
 * Pickup Slot Model & Capacity Definition.
 * Source of truth: PRD.md §6.4 (FR-BK-4), §9.1; TECH_STACK.md §7.2, §7.4; TODO.md TASK-021.
 */
@Schema({ timestamps: true, collection: 'pickup_slots' })
export class PickupSlot {
  @Prop({ required: true, default: 'ALL', trim: true, index: true })
  serviceArea: string; // e.g. '110044', 'SOUTH_DELHI', or 'ALL'

  @Prop({ required: true, trim: true, index: true })
  date: string; // YYYY-MM-DD

  @Prop({
    required: true,
    enum: [SlotKey.MORNING, SlotKey.AFTERNOON, SlotKey.EVENING],
  })
  slotKey: string;

  @Prop({ required: true, trim: true })
  label: string; // 'Morning', 'Afternoon', 'Evening'

  @Prop({ required: true, trim: true })
  timeWindow: string; // '09:00 - 12:00', '13:00 - 16:00', '17:00 - 20:00'

  @Prop({ required: true, trim: true })
  startTime: string; // '09:00', '13:00', '17:00'

  @Prop({ required: true, trim: true })
  endTime: string; // '12:00', '16:00', '20:00'

  @Prop({ required: true, default: 10, min: 0 })
  capacity: number; // Max bookings per slot per day

  @Prop({ required: true, default: 0, min: 0 })
  bookedCount: number;

  @Prop({ required: true, default: 2, min: 0 })
  cutoffHours: number; // Lead time hours before startTime required to book (default 2h)

  @Prop({ default: true, index: true })
  isActive: boolean;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PickupSlotSchema = SchemaFactory.createForClass(PickupSlot);

PickupSlotSchema.index({ date: 1, slotKey: 1, serviceArea: 1 }, { unique: true });
PickupSlotSchema.index({ date: 1, serviceArea: 1 });
