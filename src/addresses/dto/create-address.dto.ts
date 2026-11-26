import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsObject,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

export class GeoPointDto {
  @ApiProperty({ example: 28.5132 })
  @IsNumber()
  lat: number;

  @ApiProperty({ example: 77.3015 })
  @IsNumber()
  lng: number;
}

export class CreateAddressDto {
  @ApiPropertyOptional({ example: 'Home', default: 'Home' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiProperty({ example: 'Shop No. G-246, 40 Foota Road' })
  @IsNotEmpty({ message: 'Street address is required.' })
  @IsString()
  street: string;

  @ApiPropertyOptional({ example: 'Floor 1, Molarband Ext.' })
  @IsOptional()
  @IsString()
  apartment?: string;

  @ApiProperty({ example: 'New Delhi' })
  @IsNotEmpty({ message: 'City is required.' })
  @IsString()
  city: string;

  @ApiProperty({ example: 'Delhi' })
  @IsNotEmpty({ message: 'State is required.' })
  @IsString()
  state: string;

  @ApiProperty({ example: '110044' })
  @IsNotEmpty({ message: 'Postal code / pincode is required.' })
  @IsString()
  pincode: string;

  @ApiPropertyOptional({ example: true, default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ example: 'Near Metro Pillar 24, call upon arrival' })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiPropertyOptional({ type: GeoPointDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => GeoPointDto)
  geo?: GeoPointDto;
}
