import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type AddressDocument = Address & Document;

@Schema({ timestamps: true, collection: 'addresses' })
export class Address {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, trim: true, default: 'Home' })
  label: string; // 'Home', 'Office', 'Other'

  @Prop({ required: true, trim: true })
  street: string;

  @Prop({ trim: true })
  apartment?: string;

  @Prop({ required: true, trim: true })
  city: string;

  @Prop({ required: true, trim: true })
  state: string;

  @Prop({ required: true, trim: true })
  pincode: string;

  @Prop({ default: false, index: true })
  isDefault: boolean;

  @Prop({ trim: true })
  instructions?: string;

  @Prop({
    type: {
      lat: Number,
      lng: Number,
    },
    _id: false,
  })
  geo?: {
    lat: number;
    lng: number;
  };

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const AddressSchema = SchemaFactory.createForClass(Address);
AddressSchema.index({ userId: 1, isDefault: -1 });
