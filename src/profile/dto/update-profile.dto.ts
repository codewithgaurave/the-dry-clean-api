import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsEmail, IsUrl, Length } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Aditya Sharma' })
  @IsOptional()
  @IsString()
  @Length(2, 60, { message: 'Name must be between 2 and 60 characters.' })
  name?: string;

  @ApiPropertyOptional({ example: 'aditya@example.com' })
  @IsOptional()
  @IsEmail({}, { message: 'Please provide a valid email address.' })
  email?: string;

  @ApiPropertyOptional({ example: 'https://images.example.com/avatar.jpg' })
  @IsOptional()
  @IsUrl({}, { message: 'Avatar must be a valid URL.' })
  avatar?: string;
}
