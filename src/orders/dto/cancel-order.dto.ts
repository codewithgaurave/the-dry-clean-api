import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for cancelling an order.
 * Source of truth: PRD.md §6.8 (FR-ORD-3), §8.3; TODO.md TASK-033.
 */
export class CancelOrderDto {
  @ApiPropertyOptional({
    description: 'Optional customer reason for cancelling the order',
    example: 'Travelling out of town',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}
