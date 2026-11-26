import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query DTO for retrieving pickup slots availability.
 * Source of truth: PRD.md §6.4 (FR-BK-4), §10; TODO.md TASK-021.
 */
export class GetSlotsQueryDto {
  @ApiProperty({
    description: 'Target pickup date in ISO YYYY-MM-DD format',
    example: '2026-11-05',
  })
  @IsNotEmpty({ message: 'Date query parameter is required' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'Date must be formatted as YYYY-MM-DD',
  })
  date: string;

  @ApiPropertyOptional({
    description: 'Service area filter (e.g., SOUTH_DELHI or ALL)',
    example: 'ALL',
    default: 'ALL',
  })
  @IsOptional()
  @IsString()
  serviceArea?: string;

  @ApiPropertyOptional({
    description: 'Customer location pincode (e.g., 110044)',
    example: '110044',
  })
  @IsOptional()
  @IsString()
  pincode?: string;
}
