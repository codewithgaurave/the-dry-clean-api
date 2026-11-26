import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type NotificationDocument = Notification & Document;

export enum NotificationType {
  ORDER_STATUS = 'ORDER_STATUS',
  VALET_DISPATCH = 'VALET_DISPATCH',
  PROOF_AVAILABLE = 'PROOF_AVAILABLE',
  SYSTEM = 'SYSTEM',
  PROMOTION = 'PROMOTION',
}

export enum NotificationStatus {
  UNREAD = 'UNREAD',
  READ = 'READ',
}

/**
 * Notification Mongoose Schema:
 * Persists customer in-app notifications and tracks push delivery state.
 * Source of truth: PRD.md §6.9 (FR-NTF-1, FR-NTF-2), §6.12.3; TECH_STACK.md §4.1; TODO.md TASK-044.
 */
@Schema({ timestamps: true, collection: 'notifications' })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ index: true })
  orderId?: string; // Canonical order ID (e.g. "TC402738")

  @Prop({ type: Types.ObjectId, ref: 'Order' })
  orderRef?: Types.ObjectId;

  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  body: string;

  @Prop({
    type: String,
    enum: Object.values(NotificationType),
    default: NotificationType.ORDER_STATUS,
    index: true,
  })
  type: NotificationType;

  @Prop({
    type: String,
    enum: Object.values(NotificationStatus),
    default: NotificationStatus.UNREAD,
    index: true,
  })
  status: NotificationStatus;

  @Prop()
  actionUrl?: string; // e.g. "/orders/TC402738"

  @Prop()
  proofUrl?: string; // Signed S3 URL if delivery proof is attached

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  @Prop({ default: false })
  isPushSent: boolean;

  @Prop()
  pushSentAt?: Date;

  @Prop()
  pushError?: string;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

// Compound indexes for user notification inbox queries
NotificationSchema.index({ userId: 1, status: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, createdAt: -1 });
