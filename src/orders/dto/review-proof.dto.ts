import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ProofReviewAction {
  VERIFIED = 'VERIFIED',
  FLAGGED = 'FLAGGED',
}

export class ReviewProofDto {
  @ApiProperty({
    enum: ProofReviewAction,
    description: 'Review decision: VERIFIED (approved) or FLAGGED (suspicious / non-compliant)',
    example: ProofReviewAction.VERIFIED,
  })
  @IsNotEmpty()
  @IsEnum(ProofReviewAction)
  action: ProofReviewAction;

  @ApiPropertyOptional({
    description: 'Mandatory or explanatory reason if flagged for investigation',
    example: 'Photo does not show customer doorstep or house number; blurry image.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
