import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type PaymentDocument = Payment & Document;

/**
 * Payment Status enumeration.
 * Source of truth: PRD.md §6.7 (FR-PAY-2); TECH_STACK.md §7.2, §8.4.
 */
export enum PaymentStatus {
  INITIATED = 'INITIATED',
  PENDING = 'PENDING',
  SUCCESSFUL = 'SUCCESSFUL',
  FAILED = 'FAILED',
  VERIFICATION_PENDING = 'VERIFICATION_PENDING',
  REFUND_INITIATED = 'REFUND_INITIATED',
  REFUNDED = 'REFUNDED',
}

/**
 * Gateway provider type.
 */
export enum PaymentGateway {
  RAZORPAY = 'RAZORPAY',
  MOCK = 'MOCK',
}

/**
 * Payment Transaction Document.
 * Source of truth: PRD.md §6.7 (FR-PAY-1, FR-PAY-2); TECH_STACK.md §7.2, §8.4; TODO.md TASK-026.
 */
@Schema({ timestamps: true, collection: 'payments' })
export class Payment {
  @Prop({ required: true, index: true })
  orderId: string; // Canonical order tracking string (e.g. "TC402736")

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderRef: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(PaymentGateway),
    default: PaymentGateway.MOCK,
    required: true,
  })
  gateway: PaymentGateway;

  @Prop({ required: true, unique: true, index: true })
  gatewayOrderId: string; // Razorpay order id (e.g. "order_123456" or "order_mock_123456")

  @Prop()
  gatewayPaymentId?: string; // Captured payment ID (e.g. "pay_123456")

  @Prop()
  gatewaySignature?: string;

  @Prop({ required: true })
  amountMinor: number; // Integer minor units in paise

  @Prop({ required: true, default: 'INR' })
  currency: string;

  @Prop({
    type: String,
    enum: Object.values(PaymentStatus),
    default: PaymentStatus.INITIATED,
    required: true,
    index: true,
  })
  status: PaymentStatus;

  @Prop({ default: 'UPI' })
  paymentMethod: string;

  @Prop({ type: Object, default: {} })
  notes: Record<string, any>;

  @Prop()
  errorMessage?: string;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ orderId: 1, createdAt: -1 });
PaymentSchema.index({ userId: 1, status: 1 });
