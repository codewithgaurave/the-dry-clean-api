import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type OrderProofDocument = OrderProof & Document;

export enum ProofType {
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
}

export enum HandoverMethod {
  HANDED_TO_CUSTOMER = 'HANDED_TO_CUSTOMER',
  FAMILY_OR_NEIGHBOUR = 'FAMILY_OR_NEIGHBOUR',
  LEFT_AT_DOOR = 'LEFT_AT_DOOR',
  SECURITY_GUARD = 'SECURITY_GUARD',
  OTHER = 'OTHER',
}

export enum ProofReviewStatus {
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  FLAGGED = 'FLAGGED',
}

@Schema({ _id: false })
export class GeoCoordinates {
  @Prop({ required: true })
  latitude: number;

  @Prop({ required: true })
  longitude: number;

  @Prop({ default: 0 })
  accuracy?: number;
}

export const GeoCoordinatesSchema = SchemaFactory.createForClass(GeoCoordinates);

/**
 * OrderProof Mongoose Schema:
 * Immutable proof record capturing photographic evidence, timestamps, device geo-location,
 * and handover metadata for every garment pickup and delivery.
 * Source of truth: PRD.md §6.12.1, §6.12.2; TECH_STACK.md §9.4, §9.5; TODO.md TASK-035.
 */
@Schema({ timestamps: true, collection: 'order_proofs' })
export class OrderProof {
  @Prop({ required: true, index: true })
  orderId: string; // e.g., "DC-2026-0042" or "TC402736"

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderRef: Types.ObjectId;

  @Prop({ required: true })
  taskId: string; // e.g., "TSK_P_402736" or "TSK_D_402736"

  @Prop({ type: Types.ObjectId, ref: 'DeliveryTask', required: true, index: true })
  taskRef: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(ProofType),
    required: true,
    index: true,
  })
  type: ProofType;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  agentId: Types.ObjectId;

  @Prop({
    type: [String],
    required: true,
    validate: [(val: string[]) => val.length > 0, 'At least 1 photo key is required'],
  })
  photoKeys: string[];

  @Prop({ required: true })
  capturedAt: Date;

  @Prop({ default: Date.now })
  receivedAt: Date;

  @Prop({ type: GeoCoordinatesSchema })
  geo?: GeoCoordinates;

  @Prop({
    type: String,
    enum: Object.values(HandoverMethod),
    default: HandoverMethod.HANDED_TO_CUSTOMER,
  })
  handoverMethod: HandoverMethod;

  @Prop()
  note?: string;

  @Prop({
    type: String,
    enum: Object.values(ProofReviewStatus),
    default: ProofReviewStatus.PENDING,
    index: true,
  })
  reviewStatus: ProofReviewStatus;

  @Prop()
  flaggedReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  reviewedBy?: Types.ObjectId;

  @Prop()
  reviewedAt?: Date;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const OrderProofSchema = SchemaFactory.createForClass(OrderProof);

// Unique index on taskId: prevents duplicate submission for the same task
OrderProofSchema.index({ taskId: 1 }, { unique: true });

// Unique compound index on { orderId, type }: guarantees exactly one pickup and one delivery proof per order
OrderProofSchema.index({ orderId: 1, type: 1 }, { unique: true });

// Compound index for agent activity filtering
OrderProofSchema.index({ agentId: 1, type: 1, createdAt: -1 });
