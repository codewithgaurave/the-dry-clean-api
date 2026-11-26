import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type DeliveryTaskDocument = DeliveryTask & Document;

export enum TaskType {
  PICKUP = 'PICKUP',
  DELIVERY = 'DELIVERY',
}

export enum TaskStatus {
  ASSIGNED = 'ASSIGNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Schema({ timestamps: true, collection: 'delivery_tasks' })
export class DeliveryTask {
  @Prop({ required: true, unique: true, index: true })
  taskId: string; // e.g. "TSK_P_402736"

  @Prop({ required: true, index: true })
  orderId: string;

  @Prop({ type: Types.ObjectId, ref: 'Order', required: true, index: true })
  orderRef: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', index: true })
  agentId?: Types.ObjectId;

  @Prop({
    type: String,
    enum: Object.values(TaskType),
    required: true,
    index: true,
  })
  taskType: TaskType;

  @Prop({
    type: String,
    enum: Object.values(TaskStatus),
    default: TaskStatus.ASSIGNED,
    index: true,
  })
  status: TaskStatus;

  @Prop({ required: true })
  scheduledDate: string;

  @Prop({ required: true })
  scheduledTimeWindow: string;

  @Prop({ default: 1 })
  attemptNumber: number;

  @Prop({ type: Types.ObjectId, ref: 'OrderProof' })
  proofId?: Types.ObjectId;

  @Prop()
  failureReason?: string;

  @Prop()
  failureNotes?: string;

  @Prop()
  failurePhotoKey?: string;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const DeliveryTaskSchema = SchemaFactory.createForClass(DeliveryTask);
DeliveryTaskSchema.index({ agentId: 1, status: 1, scheduledDate: 1 });
