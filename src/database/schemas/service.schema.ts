import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type ServiceDocument = Service & Document;
export type ServicePriceDocument = ServicePrice & Document;

@Schema({ timestamps: true, collection: 'services' })
export class Service {
  @Prop({ required: true, trim: true, index: true })
  name: string; // e.g. "Dry Cleaning", "Premium Laundry"

  @Prop({ trim: true })
  description?: string;

  @Prop({ required: true, trim: true, index: true })
  category: string; // "DRY_CLEAN", "LAUNDRY", "STEAM_PRESS", "DELICATES"

  @Prop()
  icon?: string;

  @Prop({ trim: true })
  turnaroundTime?: string; // e.g. "48-72 Hours", "24-48 Hours"

  @Prop({ default: 48 })
  turnaroundHours: number;

  @Prop({ default: true, index: true })
  active: boolean;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ServiceSchema = SchemaFactory.createForClass(Service);

@Schema({ timestamps: true, collection: 'service_prices' })
export class ServicePrice {
  @Prop({ type: Types.ObjectId, ref: 'Service', required: true, index: true })
  serviceId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  itemType: string; // e.g. "Suit (2-Piece)", "Silk Saree", "Shirt"

  @Prop({ trim: true })
  package?: string; // e.g. "Basic", "Premium", "Express"

  @Prop({ required: true, default: 'piece' })
  unit: string; // 'piece', 'kg', 'pair'

  @Prop({ required: true })
  amountMinor: number; // e.g. 35000 = ₹350.00 (minor units, TECH_STACK §7.2)

  @Prop({ required: true, default: 'INR' })
  currency: string;

  @Prop({ default: false, index: true })
  isAddon: boolean;

  @Prop({ trim: true })
  description?: string;

  @Prop({ default: Date.now, index: true })
  effectiveDate: Date;

  @Prop({ default: true, index: true })
  active: boolean;

  @Prop({ default: 1 })
  schemaVersion: number;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ServicePriceSchema = SchemaFactory.createForClass(ServicePrice);
ServicePriceSchema.index({ serviceId: 1, itemType: 1, package: 1, active: 1 });
