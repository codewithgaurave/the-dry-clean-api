import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskType } from '../../database/schemas/delivery-task.schema';

export class AdminAssignOrderDto {
  @ApiProperty({
    description: 'MongoDB ObjectId or identifier of the courier/valet agent to assign',
    example: '6724dc528c12a819c4701234',
  })
  @IsNotEmpty()
  @IsString()
  agentId: string;

  @ApiPropertyOptional({
    enum: TaskType,
    description: 'Task type (PICKUP or DELIVERY). If omitted, determined by order lifecycle state.',
    example: TaskType.PICKUP,
  })
  @IsOptional()
  @IsEnum(TaskType)
  taskType?: TaskType;

  @ApiPropertyOptional({
    description: 'Scheduled execution date in YYYY-MM-DD format',
    example: '2026-11-03',
  })
  @IsOptional()
  @IsString()
  scheduledDate?: string;

  @ApiPropertyOptional({
    description: 'Scheduled window label',
    example: '10:00 AM - 12:00 PM',
  })
  @IsOptional()
  @IsString()
  scheduledTimeWindow?: string;
}
