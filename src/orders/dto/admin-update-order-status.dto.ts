import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus } from '../order-status.enum';

export class AdminUpdateOrderStatusDto {
  @ApiProperty({
    enum: OrderStatus,
    description: 'Target order status in facility lifecycle',
    example: OrderStatus.QUALITY_CHECK,
  })
  @IsNotEmpty()
  @IsEnum(OrderStatus)
  status: OrderStatus;

  @ApiPropertyOptional({
    description: 'Operational audit note describing action or quality check assessment',
    example: 'Stain treatment completed. Hand-finishing and steam pressing verified.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
