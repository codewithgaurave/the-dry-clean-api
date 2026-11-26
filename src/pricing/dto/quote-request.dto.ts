import {
  IsString,
  IsNotEmpty,
  IsInt,
  Min,
  IsOptional,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QuoteItemDto {
  @ApiProperty({
    description: 'MongoDB ObjectId of the service category',
    example: '6723ef981234567890abcdef',
  })
  @IsString()
  @IsNotEmpty()
  serviceId: string;

  @ApiProperty({
    description: 'Garment or item type',
    example: "Men's Suit (2-Piece)",
  })
  @IsString()
  @IsNotEmpty()
  itemType: string;

  @ApiProperty({
    description: 'Quantity of items or weight in kg',
    example: 1,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Package option (e.g. Standard, Premium Atelier Care, Express)',
    example: 'Standard',
  })
  @IsOptional()
  @IsString()
  package?: string;

  @ApiPropertyOptional({
    description: 'List of add-on ServicePrice ObjectIds',
    example: ['6723ef981234567890abc001'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  addonIds?: string[];
}

export class QuoteRequestDto {
  @ApiProperty({
    description: 'List of line items to price',
    type: [QuoteItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items: QuoteItemDto[];

  @ApiPropertyOptional({
    description: 'Optional promotional coupon code to apply',
    example: 'WELCOME10',
  })
  @IsOptional()
  @IsString()
  couponCode?: string;
}
