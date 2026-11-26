import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { OrderStatus } from '../../orders/order-status.enum';

export type OrderDocument = Order & Document;

@Schema({ _id: false })
export class AddressSnapshot {
  @Prop({ required: true })
  label: string;

  @Prop({ required: true })
  street: string;

  @Prop()
  apartment?: string;

  @Prop({ required: true })
  city: string;

  @Prop({ required: true })
  state: string;

  @Prop({ required: true })
  pincode: string;

  @Prop({
    type: {
      lat: Number,
      lng: Number,
    },
    _id: false,
  })
  geo?: {
    lat: number;
    lng: number;
  };
}

export const AddressSnapshotSchema = SchemaFactory.createForClass(AddressSnapshot);

@Schema({ _id: false })
export class OrderItemSnapshot {
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

export const OrderItemSnapshotSchema = SchemaFactory.createForClass(OrderItemSnapshot);

@Schema({ _id: false })
export class PricingSnapshot {
  @Prop({ required: true })
  subtotalMinor: number;

  @Prop({ default: 0 })
  discountMinor: number;

  @Prop({ default: 0 })
  deliveryFeeMinor: number;

  @Prop({ required: true })
  totalAmountMinor: number;

  @Prop({ required: true, default: 'INR' })
  currency: string;

  @Prop()
  couponCode?: string;
}

export const PricingSnapshotSchema = SchemaFactory.createForClass(PricingSnapshot);

@Schema({ timestamps: true, collection: 'orders' })
export class Order {
  @Prop({ required: true, unique: true, index: true })
  orderId: string; // e.g. "TC402736"

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Booking', sparse: true, unique: true })
  bookingId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(OrderStatus),
    default: OrderStatus.CONFIRMED,
    required: true,
    index: true,
  })
  status: OrderStatus;

  @Prop({ type: AddressSnapshotSchema, required: true })
  addressSnapshot: AddressSnapshot;

  @Prop({ type: [OrderItemSnapshotSchema], required: true })
  items: OrderItemSnapshot[];

  @Prop({ type: PricingSnapshotSchema, required: true })
  pricingSnapshot: PricingSnapshot;

  @Prop({
    required: true,
    enum: ['PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED'],
    default: 'PENDING',
  })
  paymentStatus: string;

  @Prop({ default: 'UPI' })
  paymentMethod: string;

  @Prop({ type: Types.ObjectId, ref: 'OrderProof' })
  pickupProofId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrderProof' })
  deliveryProofId?: Types.ObjectId;

  @Prop({
    type: {
      type: { type: String, enum: ['PICKUP', 'DELIVERY'] },
      date: String,
      timeSlot: String,
    },
    _id: false,
  })
  currentScheduledWindow?: {
    type: 'PICKUP' | 'DELIVERY';
    date: string;
    timeSlot: string;
  };

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);
OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });
