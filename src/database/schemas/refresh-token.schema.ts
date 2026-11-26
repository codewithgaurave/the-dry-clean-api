import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type RefreshTokenDocument = RefreshToken & Document;

/**
 * Rotating Refresh Tokens with TTL cleanup.
 * Source of truth: TECH_STACK.md §4.1, §8.1; TODO.md TASK-012.
 */
@Schema({ timestamps: { createdAt: true, updatedAt: false }, collection: 'refresh_tokens' })
export class RefreshToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ required: true, unique: true, index: true })
  tokenHash: string;

  @Prop({ required: true, index: { expireAfterSeconds: 0 } })
  expiresAt: Date;

  @Prop({ default: false, index: true })
  revoked: boolean;

  createdAt?: Date;
}

export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);
