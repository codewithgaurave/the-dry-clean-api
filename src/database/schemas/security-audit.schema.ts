import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SecurityAuditDocument = SecurityAudit & Document;

export enum SecurityAnomalyType {
  DELIVERY_WITHOUT_PROOF = 'DELIVERY_WITHOUT_PROOF',
  PICKUP_WITHOUT_PROOF = 'PICKUP_WITHOUT_PROOF',
  DANGLING_PROOF_WITHOUT_PHOTOS = 'DANGLING_PROOF_WITHOUT_PHOTOS',
  UNAUTHORIZED_STATUS_BYPASS = 'UNAUTHORIZED_STATUS_BYPASS',
}

export enum SecurityAnomalySeverity {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
}

export enum SecurityAnomalyStatus {
  UNRESOLVED = 'UNRESOLVED',
  INVESTIGATING = 'INVESTIGATING',
  RESOLVED = 'RESOLVED',
}

/**
 * SecurityAudit Mongoose Schema:
 * Persists detected invariant violations, bypass attempts, and audit anomalies
 * identified by background reconciliation workers.
 * Source of truth: TECH_STACK.md §9.5; PRD.md §6.12.2, §8.2; TODO.md TASK-046.
 */
@Schema({ timestamps: true, collection: 'security_audits' })
export class SecurityAudit {
  @Prop({
    type: String,
    enum: Object.values(SecurityAnomalyType),
    required: true,
    index: true,
  })
  anomalyType: SecurityAnomalyType;

  @Prop({
    type: String,
    enum: Object.values(SecurityAnomalySeverity),
    default: SecurityAnomalySeverity.CRITICAL,
    index: true,
  })
  severity: SecurityAnomalySeverity;

  @Prop({ required: true, index: true })
  orderId: string; // e.g. "TC402738"

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderRef: Types.ObjectId;

  @Prop({ required: true })
  description: string;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;

  @Prop({
    type: String,
    enum: Object.values(SecurityAnomalyStatus),
    default: SecurityAnomalyStatus.UNRESOLVED,
    index: true,
  })
  status: SecurityAnomalyStatus;

  @Prop()
  resolutionNote?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop()
  resolvedAt?: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SecurityAuditSchema = SchemaFactory.createForClass(SecurityAudit);

SecurityAuditSchema.index({ anomalyType: 1, status: 1 });
SecurityAuditSchema.index({ orderId: 1, createdAt: -1 });
