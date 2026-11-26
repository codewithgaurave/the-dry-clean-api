import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for rescheduling pickup for an active order.
 * Source of truth: PRD.md §6.8 (FR-ORD-4), §8.3; TODO.md TASK-033.
 */
export class RescheduleOrderDto {
  @ApiProperty({
    description: 'New scheduled date for pickup (e.g. YYYY-MM-DD or 25 Oct 2026)',
    example: '2026-10-28',
  })
  @IsNotEmpty()
  @IsString()
  date: string;

  @ApiProperty({
    description: 'New scheduled time slot for pickup (e.g. 14:00 - 16:00)',
    example: '14:00 - 16:00',
  })
  @IsNotEmpty()
  @IsString()
  timeSlot: string;

  @ApiPropertyOptional({
    description: 'Optional customer note or reason for rescheduling',
    example: 'Available only in the afternoon',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
