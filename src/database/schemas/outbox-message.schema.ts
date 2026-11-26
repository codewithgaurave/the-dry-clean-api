import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OutboxMessageDocument = OutboxMessage & Document;

export enum OutboxStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  PROCESSED = 'PROCESSED',
  FAILED = 'FAILED',
}

/**
 * Transactional MongoDB Outbox Message Schema.
 * Source of truth: TECH_STACK.md §4.1, §7.5; TODO.md TASK-011.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: true }, collection: 'outbox' })
export class OutboxMessage {
  @Prop({ required: true, index: true, trim: true })
  eventType: string; // e.g. "ORDER_STATUS_CHANGED", "PAYMENT_CONFIRMED"

  @Prop({ type: Object, required: true })
  payload: Record<string, any>;

  @Prop({
    type: String,
    enum: Object.values(OutboxStatus),
    default: OutboxStatus.PENDING,
    index: true,
  })
  status: OutboxStatus;

  @Prop({ default: 0 })
  retryCount: number;

  @Prop({ default: 5 })
  maxRetries: number;

  @Prop()
  lastError?: string;

  @Prop()
  processedAt?: Date;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OutboxMessageSchema = SchemaFactory.createForClass(OutboxMessage);
OutboxMessageSchema.index({ status: 1, createdAt: 1 });
