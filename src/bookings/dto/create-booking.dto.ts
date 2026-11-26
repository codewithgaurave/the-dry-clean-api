import {
  IsNotEmpty,
  IsString,
  IsArray,
  ValidateNested,
  IsOptional,
  IsNumber,
  Min,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BookingItemDto {
  @ApiProperty({ description: 'MongoDB ObjectId of the service' })
  @IsNotEmpty()
  @IsString()
  serviceId: string;

  @ApiProperty({ description: 'Service name (e.g. Dry Cleaning)' })
  @IsNotEmpty()
  @IsString()
  serviceName: string;

  @ApiProperty({ description: 'Garment type (e.g. Men Two-Piece Suit)' })
  @IsNotEmpty()
  @IsString()
  itemType: string;

  @ApiProperty({ description: 'Item quantity', default: 1, minimum: 1 })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: 'Unit price in minor units (re-verified on server)' })
  @IsOptional()
  @IsNumber()
  unitPriceMinor?: number;

  @ApiPropertyOptional({ description: 'Selected care add-ons', type: [String] })
  @IsOptional()
  @IsArray()
  addOns?: string[];
}

/**
 * Request DTO for creating an authoritative booking and order.
 * Source of truth: PRD.md §6.4 (FR-BK-7, FR-BK-8), §10; TECH_STACK.md §7.2; TODO.md TASK-024.
 */
export class CreateBookingDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the pickup address',
    example: '66fa3b5b1a2c3d4e5f678901',
  })
  @IsNotEmpty()
  @IsString()
  pickupAddressId: string;

  @ApiProperty({
    description: 'MongoDB ObjectId of the pickup slot',
    example: '66fa3b5b1a2c3d4e5f678902',
  })
  @IsNotEmpty()
  @IsString()
  pickupSlotId: string;

  @ApiProperty({
    description: 'Scheduled pickup date (YYYY-MM-DD)',
    example: '2026-11-05',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Date must be formatted as YYYY-MM-DD' })
  scheduledDate: string;

  @ApiProperty({
    description: 'Scheduled collection window string (e.g. 09:00 - 12:00)',
    example: '09:00 - 12:00',
  })
  @IsNotEmpty()
  @IsString()
  scheduledTimeSlot: string;

  @ApiProperty({
    description: 'List of garment care items and quantities',
    type: [BookingItemDto],
  })
  @IsNotEmpty()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingItemDto)
  items: BookingItemDto[];

  @ApiPropertyOptional({
    description: 'Optional promotional coupon code to apply',
    example: 'WELCOME10',
  })
  @IsOptional()
  @IsString()
  couponCode?: string;

  @ApiPropertyOptional({
    description: 'Payment method (UPI, CARD, CASH)',
    default: 'UPI',
    example: 'UPI',
  })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({
    description: 'Special pickup or handling instructions',
    example: 'Gate 2, call before arriving',
  })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({
    description: 'User ID override for testing or guest context',
  })
  @IsOptional()
  @IsString()
  userId?: string;
}
