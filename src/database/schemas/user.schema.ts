import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { OrderActorRole } from '../../orders/order-status.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true, index: true, trim: true })
  phone: string;

  @Prop({ trim: true })
  name?: string;

  @Prop({ trim: true, lowercase: true })
  email?: string;

  @Prop({
    type: String,
    enum: Object.values(OrderActorRole),
    default: OrderActorRole.CUSTOMER,
    index: true,
  })
  role: OrderActorRole;

  @Prop()
  avatar?: string;

  @Prop({ trim: true, index: true })
  fcmToken?: string;

  @Prop({ trim: true })
  devicePlatform?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
