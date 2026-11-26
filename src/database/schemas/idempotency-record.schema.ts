import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type IdempotencyRecordDocument = IdempotencyRecord & Document;

/**
 * Idempotency Record Schema ensuring atomic deduplication on retried operations.
 * Source of truth: PRD.md §6.4 (FR-BK-8), §9.3; TECH_STACK.md §7.2, §8.3; TODO.md TASK-024.
 */
@Schema({ timestamps: true, collection: 'idempotency_records' })
export class IdempotencyRecord {
  @Prop({ required: true, trim: true, index: true })
  scope: string; // e.g. 'BOOKING', 'PAYMENT', 'PROOF'

  @Prop({ required: true, trim: true, index: true })
  key: string; // The client-provided Idempotency-Key header value

  @Prop({ required: true })
  requestHash: string; // SHA-256 hash of the request payload

  @Prop({ type: Object, required: true })
  responseSnapshot: Record<string, any>; // Cached response payload returned on retry

  @Prop({ required: true, default: 201 })
  statusCode: number;

  @Prop({ type: Types.ObjectId })
  resourceId?: Types.ObjectId;

  @Prop({ required: true })
  expiresAt: Date; // TTL index
}

export const IdempotencyRecordSchema = SchemaFactory.createForClass(IdempotencyRecord);

IdempotencyRecordSchema.index({ scope: 1, key: 1 }, { unique: true });
IdempotencyRecordSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
