import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { OrderStatus, OrderActorRole } from '../../orders/order-status.enum';

export type OrderStatusEventDocument = OrderStatusEvent & Document;

@Schema({ _id: false })
export class EventActor {
  @Prop({
    type: String,
    enum: Object.values(OrderActorRole),
    required: true,
  })
  actorRole: OrderActorRole;

  @Prop({ required: true })
  actorId: string;

  @Prop()
  name?: string;
}

export const EventActorSchema = SchemaFactory.createForClass(EventActor);

/**
 * Append-only Order Status Event Logger Schema.
 * Source of truth: PRD.md §8.5, §9.1; TECH_STACK.md §7.2; TODO.md TASK-010.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'order_status_events' })
export class OrderStatusEvent {
  @Prop({ required: true, index: true })
  orderId: string; // Business order ID e.g. "TC402736"

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderRef: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(OrderStatus),
    required: true,
  })
  previousStatus: OrderStatus;

  @Prop({
    type: String,
    enum: Object.values(OrderStatus),
    required: true,
    index: true,
  })
  status: OrderStatus;

  @Prop({ type: EventActorSchema, required: true })
  updatedBy: EventActor;

  @Prop({ required: true, default: Date.now, index: true })
  timestamp: Date;

  @Prop({ trim: true })
  note?: string;

  @Prop({ trim: true, index: true })
  proofId?: string;

  @Prop({ type: Object })
  metadata?: Record<string, any>;

  createdAt?: Date;
}

export const OrderStatusEventSchema = SchemaFactory.createForClass(OrderStatusEvent);
OrderStatusEventSchema.index({ orderId: 1, timestamp: 1 });
OrderStatusEventSchema.index({ orderRef: 1, timestamp: 1 });
