import { IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for customer reporting an issue or disputing delivery.
 * Source of truth: PRD.md §6.12.3 (FR-POD-23); TECH_STACK.md §7.2, §7.3; TODO.md TASK-040.
 */
export class ReportIssueDto {
  @ApiProperty({
    description: 'Category or reason for the delivery dispute / order issue',
    example: 'PACKAGE_NOT_RECEIVED',
  })
  @IsString()
  @IsNotEmpty()
  reason: string;

  @ApiProperty({
    description: 'Detailed description explaining the issue experienced by customer',
    example:
      'The photo shows a doorstep with green tiles, but my doorstep is white marble. I have not received my garments.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  description: string;

  @ApiPropertyOptional({
    description: 'Optional ID of the specific OrderProof being disputed',
    example: '6724fa10b91e70c53e0d8b44',
  })
  @IsOptional()
  @IsString()
  proofId?: string;

  @ApiPropertyOptional({
    description: 'Optional custom subject title for the support ticket',
    example: 'Did not receive garments - photo location is incorrect',
  })
  @IsOptional()
  @IsString()
  subject?: string;
}

export interface SupportTicketResponse {
  ticketId: string;
  ticketNumber: string;
  orderId: string;
  proofId?: string;
  type: string;
  subject: string;
  description: string;
  status: string;
  priority: string;
  createdAt: string;
}
