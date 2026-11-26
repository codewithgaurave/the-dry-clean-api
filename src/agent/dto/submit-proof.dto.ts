import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { HandoverMethod } from '../../database/schemas/order-proof.schema';

/**
 * DTO for Agent Proof of Pickup / Delivery submission.
 * Accepts metadata alongside multipart photo uploads.
 * Source of truth: PRD.md §6.12.1 (FR-POD-2, FR-POD-3, FR-POD-7, FR-POD-8, FR-POD-10); TECH_STACK.md §9.4.
 */
export class SubmitProofDto {
  @ApiPropertyOptional({
    description: 'ISO string of device timestamp when photo was captured',
    example: '2026-11-01T10:30:00.000Z',
  })
  @IsOptional()
  @IsString()
  capturedAt?: string;

  @ApiPropertyOptional({
    description: 'Handover method used at doorstep or facility',
    enum: HandoverMethod,
    example: HandoverMethod.HANDED_TO_CUSTOMER,
  })
  @IsOptional()
  @IsEnum(HandoverMethod)
  handoverMethod?: HandoverMethod;

  @ApiPropertyOptional({
    description: 'Optional note from agent regarding garment condition or delivery location',
    example: 'Handed to building security guard at reception desk.',
  })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({
    description: 'Device GPS latitude at capture',
    example: 19.076,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  latitude?: number;

  @ApiPropertyOptional({
    description: 'Device GPS longitude at capture',
    example: 72.8777,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Device GPS accuracy in meters',
    example: 5.2,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracy?: number;

  @ApiPropertyOptional({
    description: 'Pre-uploaded S3 storage photo keys (if uploaded prior to proof submission)',
    example: ['proofs/TSK_P_402736_1730458800000_0.jpeg'],
  })
  @IsOptional()
  photoKeys?: string[] | string;
}

export interface ProofSubmissionResponse {
  success: boolean;
  proofId: string;
  taskId: string;
  orderId: string;
  type: string;
  status: string;
  photoKeys: string[];
  signedUrls: string[];
  handoverMethod: string;
  capturedAt: Date;
  receivedAt: Date;
  reviewStatus: string;
}
