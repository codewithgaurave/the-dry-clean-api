import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Request payload for creating a payment intent.
 * Source of truth: PRD.md §6.7 (FR-PAY-1); TECH_STACK.md §8.2, §8.4; TODO.md TASK-026.
 */
export class CreatePaymentIntentDto {
  @ApiProperty({
    description: 'Human-readable order tracking ID (e.g. TC402736)',
    example: 'TC402736',
  })
  @IsNotEmpty()
  @IsString()
  orderId: string;

  @ApiPropertyOptional({
    description: 'Chosen payment method (UPI, CARD, NETBANKING, CASH)',
    example: 'UPI',
    default: 'UPI',
  })
  @IsOptional()
  @IsString()
  paymentMethod?: string;
}
