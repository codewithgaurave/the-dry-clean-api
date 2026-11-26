import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for creating a customer support ticket.
 * Source of truth: PRD.md §6.11 (FR-SUP-1), §10; TODO.md TASK-045.
 */
export class CreateSupportTicketDto {
  @ApiProperty({
    description: 'Headline or summary of the support request',
    example: 'Query regarding cashmere dry cleaning duration',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  subject: string;

  @ApiProperty({
    description: 'Detailed explanation of customer query, issue, or request',
    example:
      'I placed order TC402738 for dry cleaning silk and wool, and would like to confirm delicate fabric handling.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  description: string;

  @ApiPropertyOptional({
    description: 'Associated canonical order ID if query pertains to an active or past order',
    example: 'TC402738',
  })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiPropertyOptional({
    description:
      'Category of query: GENERAL, ORDER_ISSUE, PAYMENT, DELIVERY_DISPUTE, GARMENT_CARE, OTHER',
    example: 'GARMENT_CARE',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({
    description: 'Priority level: LOW, MEDIUM, HIGH, URGENT',
    example: 'MEDIUM',
  })
  @IsOptional()
  @IsString()
  priority?: string;
}
