import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type SupportTicketDocument = SupportTicket & Document;

export enum SupportTicketType {
  DELIVERY_DISPUTE = 'DELIVERY_DISPUTE',
  ORDER_ISSUE = 'ORDER_ISSUE',
  DAMAGED_ITEMS = 'DAMAGED_ITEMS',
  WRONG_ITEMS = 'WRONG_ITEMS',
  BILLING = 'BILLING',
  OTHER = 'OTHER',
}

export enum SupportTicketStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

export enum TicketPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

/**
 * SupportTicket Mongoose Schema:
 * Persists customer dispute and order issue requests linked to order proofs and orders.
 * Source of truth: PRD.md §6.12.3 (FR-POD-23), §8.2, §9.1; TECH_STACK.md §7.2, §7.3.
 */
@Schema({ timestamps: true, collection: 'support_tickets' })
export class SupportTicket {
  @Prop({ required: true, unique: true, index: true })
  ticketNumber: string; // e.g. "TKT-402736-9281"

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: false, index: true })
  orderId?: string; // Canonical order ID (e.g. "TC402736")

  @Prop({ type: Types.ObjectId, ref: 'Order', required: false, index: true })
  orderRef?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'OrderProof', index: true })
  proofId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(SupportTicketType),
    default: SupportTicketType.DELIVERY_DISPUTE,
    index: true,
  })
  type: SupportTicketType;

  @Prop({ required: true })
  subject: string;

  @Prop({ required: true })
  description: string;

  @Prop({
    type: String,
    enum: Object.values(SupportTicketStatus),
    default: SupportTicketStatus.OPEN,
    index: true,
  })
  status: SupportTicketStatus;

  @Prop({
    type: String,
    enum: Object.values(TicketPriority),
    default: TicketPriority.HIGH,
  })
  priority: TicketPriority;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  assignedTo?: Types.ObjectId;

  @Prop()
  resolutionNote?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  createdAt?: Date;
  updatedAt?: Date;
}

export const SupportTicketSchema = SchemaFactory.createForClass(SupportTicket);

// Compound index for user tickets queries
SupportTicketSchema.index({ userId: 1, createdAt: -1 });
// Compound index for order tickets queries
SupportTicketSchema.index({ orderId: 1, createdAt: -1 });
