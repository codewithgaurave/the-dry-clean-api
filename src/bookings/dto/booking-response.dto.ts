import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PricingBreakdownDto {
  @ApiProperty({ example: 45000 })
  subtotalMinor: number;

  @ApiProperty({ example: 4500 })
  discountMinor: number;

  @ApiProperty({ example: 0 })
  deliveryFeeMinor: number;

  @ApiProperty({ example: 7290 })
  gstMinor: number;

  @ApiProperty({ example: 47790 })
  totalAmountMinor: number;

  @ApiProperty({ example: '₹477.90' })
  totalAmountFormatted: string;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiPropertyOptional({ example: 'WELCOME10' })
  couponCode?: string;
}

/**
 * Standard booking and created order response DTO.
 * Source of truth: PRD.md §6.4 (FR-BK-8, FR-BK-9); TECH_STACK.md §7.2; TODO.md TASK-024.
 */
export class BookingResponseDto {
  @ApiProperty({ example: '66fa3b5b1a2c3d4e5f678903' })
  bookingId: string;

  @ApiProperty({ example: 'TC402736', description: 'Unique human-readable order tracking ID' })
  orderId: string;

  @ApiProperty({ example: 'PAYMENT_PENDING', enum: ['PAYMENT_PENDING', 'CONFIRMED'] })
  status: string;

  @ApiProperty({ example: 'PENDING', enum: ['PENDING', 'PAID'] })
  paymentStatus: string;

  @ApiProperty({ example: 'UPI' })
  paymentMethod: string;

  @ApiProperty({ example: '2026-11-05' })
  scheduledDate: string;

  @ApiProperty({ example: '09:00 - 12:00' })
  scheduledTimeSlot: string;

  @ApiProperty({ description: 'Snapshotted pickup address' })
  pickupAddress: any;

  @ApiProperty({ description: 'Snapshotted order items with server-verified prices' })
  items: any[];

  @ApiProperty({ description: 'Financial pricing breakdown' })
  pricing: PricingBreakdownDto;

  @ApiProperty({ example: 'TSK_P_402736', description: 'Assigned delivery task identifier' })
  deliveryTaskId: string;

  @ApiPropertyOptional({
    description:
      'Flag indicating whether this response was an idempotent replay of an existing order',
    example: false,
  })
  isIdempotentReplay?: boolean;

  @ApiProperty()
  createdAt: Date;
}
