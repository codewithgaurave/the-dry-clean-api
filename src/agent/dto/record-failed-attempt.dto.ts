import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Standard reasons for a failed pickup or delivery attempt.
 * Source of truth: PRD.md §6.12.1 (FR-POD-11); TECH_STACK.md §9.4, §9.5.
 */
export enum FailedAttemptReason {
  CUSTOMER_UNAVAILABLE = 'CUSTOMER_UNAVAILABLE',
  GATE_LOCKED = 'GATE_LOCKED',
  RESCHEDULE_REQUESTED = 'RESCHEDULE_REQUESTED',
  WRONG_ADDRESS = 'WRONG_ADDRESS',
  OTHER = 'OTHER',
}

/**
 * DTO for recording a failed pickup or delivery attempt by an agent.
 * Source of truth: PRD.md §6.12.1 (FR-POD-11, FR-POD-30); TECH_STACK.md §9.4, §9.5; TODO.md TASK-036.
 */
export class RecordFailedAttemptDto {
  @ApiProperty({
    description:
      'Reason for the failed attempt (e.g. Customer unavailable, Gate locked, Reschedule requested)',
    example: 'CUSTOMER_UNAVAILABLE',
  })
  @IsNotEmpty()
  @IsString()
  reason: string;

  @ApiPropertyOptional({
    description: 'Optional additional explanation or notes from the agent',
    example:
      'Called customer 3 times, phone switched off and security confirmed resident not home.',
  })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({
    description: 'Pre-uploaded storage key of photo evidence (e.g. locked gate or doorstep)',
    example: 'failed-attempts/TSK_P_402736_1730458800000.jpeg',
  })
  @IsOptional()
  @IsString()
  photoKey?: string;

  @ApiPropertyOptional({
    description: 'Agent GPS latitude at the time of failed attempt',
    example: 19.076,
  })
  @IsOptional()
  latitude?: number | string;

  @ApiPropertyOptional({
    description: 'Agent GPS longitude at the time of failed attempt',
    example: 72.8777,
  })
  @IsOptional()
  longitude?: number | string;

  @ApiPropertyOptional({
    description: 'Agent GPS accuracy in meters',
    example: 5.2,
  })
  @IsOptional()
  accuracy?: number | string;
}

export interface FailedAttemptResponse {
  success: boolean;
  taskId: string;
  orderId: string;
  taskType: string;
  taskStatus: string;
  orderStatus: string;
  reason: string;
  notes?: string;
  photoKey?: string;
  signedPhotoUrl?: string;
  timestamp: Date;
}
