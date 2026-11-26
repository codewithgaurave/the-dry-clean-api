import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard slot response DTO representing an individual pickup window with availability state.
 * Source of truth: PRD.md §6.4 (FR-BK-4), §9.1; TECH_STACK.md §7.2; TODO.md TASK-021.
 */
export class PickupSlotResponseDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the pickup slot',
    example: '66fa3b5b1a2c3d4e5f678901',
  })
  id: string;

  @ApiProperty({
    description: 'Slot identifier key',
    enum: ['MORNING', 'AFTERNOON', 'EVENING'],
    example: 'MORNING',
  })
  slotKey: string;

  @ApiProperty({
    description: 'Human-readable slot window label',
    example: 'Morning',
  })
  label: string;

  @ApiProperty({
    description: 'Formatted time window string',
    example: '09:00 - 12:00',
  })
  timeWindow: string;

  @ApiProperty({
    description: 'Window start time (24-hour HH:mm)',
    example: '09:00',
  })
  startTime: string;

  @ApiProperty({
    description: 'Window end time (24-hour HH:mm)',
    example: '12:00',
  })
  endTime: string;

  @ApiProperty({
    description: 'Scheduled date (YYYY-MM-DD)',
    example: '2026-11-05',
  })
  date: string;

  @ApiProperty({
    description: 'Operating service area or pincode',
    example: 'ALL',
  })
  serviceArea: string;

  @ApiProperty({
    description: 'Maximum booking capacity for this slot',
    example: 10,
  })
  capacity: number;

  @ApiProperty({
    description: 'Active bookings currently scheduled in this window',
    example: 2,
  })
  bookedCount: number;

  @ApiProperty({
    description: 'Remaining available capacity slots',
    example: 8,
  })
  remainingCapacity: number;

  @ApiProperty({
    description: 'Whether this slot can currently be selected by customers',
    example: true,
  })
  isAvailable: boolean;

  @ApiPropertyOptional({
    description: 'Reason if slot is not available for booking',
    enum: ['CUTOFF_PASSED', 'CAPACITY_REACHED', 'SLOT_INACTIVE'],
    nullable: true,
    example: 'CUTOFF_PASSED',
  })
  unavailableReason?: 'CUTOFF_PASSED' | 'CAPACITY_REACHED' | 'SLOT_INACTIVE' | null;

  @ApiProperty({
    description: 'Time by which booking must be completed (2h prior to startTime)',
    example: '07:00',
  })
  cutoffTime: string;
}
