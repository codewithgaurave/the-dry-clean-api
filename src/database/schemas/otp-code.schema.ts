import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type OtpCodeDocument = OtpCode & Document;

/**
 * Temporary OTP Verification Records with Auto-Expiring TTL.
 * Source of truth: PRD.md §6.1, §10; TECH_STACK.md §4.1; TODO.md TASK-012.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'otp_codes' })
export class OtpCode {
  @Prop({ required: true, index: true, trim: true })
  phone: string;

  @Prop({ required: true })
  code: string;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;

  @Prop({ default: 0 })
  attempts: number;

  @Prop({ default: false })
  verified: boolean;

  createdAt?: Date;
}

export const OtpCodeSchema = SchemaFactory.createForClass(OtpCode);
OtpCodeSchema.index({ phone: 1, createdAt: -1 });
