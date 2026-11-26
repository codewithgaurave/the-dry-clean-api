import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type BookingDocument = Booking & Document;

@Schema({ _id: false })
export class BookingItem {
  @Prop({ type: Types.ObjectId, ref: 'Service', required: true })
  serviceId: Types.ObjectId;

  @Prop({ required: true })
  serviceName: string;

  @Prop({ required: true })
  itemType: string;

  @Prop({ required: true, min: 1 })
  quantity: number;

  @Prop({ required: true })
  unitPriceMinor: number;

  @Prop({ required: true })
  totalPriceMinor: number;

  @Prop({ type: [String], default: [] })
  addOns?: string[];
}

export const BookingItemSchema = SchemaFactory.createForClass(BookingItem);

@Schema({ timestamps: true, collection: 'bookings' })
export class Booking {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Address', required: true })
  pickupAddressId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'PickupSlot' })
  pickupSlotId?: Types.ObjectId;

  @Prop({ required: true })
  scheduledDate: string; // YYYY-MM-DD

  @Prop({ required: true })
  scheduledTimeSlot: string; // e.g. "9 AM - 12 PM"

  @Prop({ type: [BookingItemSchema], required: true })
  items: BookingItem[];

  @Prop({ required: true })
  subtotalMinor: number;

  @Prop({ default: 0 })
  discountMinor: number;

  @Prop({ default: 0 })
  deliveryFeeMinor: number;

  @Prop({ required: true })
  totalAmountMinor: number;

  @Prop({ trim: true })
  couponCode?: string;

  @Prop({
    required: true,
    enum: ['DRAFT', 'CONFIRMED', 'CANCELLED'],
    default: 'DRAFT',
    index: true,
  })
  status: string;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const BookingSchema = SchemaFactory.createForClass(Booking);
BookingSchema.index({ userId: 1, createdAt: -1 });
