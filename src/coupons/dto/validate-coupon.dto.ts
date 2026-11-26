import { IsNotEmpty, IsOptional, IsString, IsNumber, Min, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request payload for validating a promotional coupon.
 * Source of truth: PRD.md §6.5 (FR-PR-3, FR-PR-4), §10; TODO.md TASK-023.
 */
export class ValidateCouponDto {
  @ApiProperty({
    description: 'Promotional coupon code (e.g., WELCOME10, FLAT100)',
    example: 'WELCOME10',
  })
  @IsNotEmpty({ message: 'Coupon code is required' })
  @IsString()
  code: string;

  @ApiProperty({
    description: 'Order subtotal in minor integer units (paise)',
    example: 45000,
  })
  @IsNotEmpty({ message: 'Order subtotal is required' })
  @IsNumber()
  @Min(0, { message: 'Subtotal cannot be negative' })
  subtotalMinor: number;

  @ApiPropertyOptional({
    description: 'Service categories present in the order (e.g. DRY_CLEAN, WASH_FOLD)',
    example: ['DRY_CLEAN'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  categories?: string[];

  @ApiPropertyOptional({
    description: 'Customer user ID for checking per-user usage limits',
    example: '66fa3b5b1a2c3d4e5f678901',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
