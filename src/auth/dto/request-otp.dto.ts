import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'E.164 formatted customer or agent phone number',
  })
  @IsNotEmpty({ message: 'Phone number is required.' })
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'Phone number must be a valid international format (e.g. +919876543210).',
  })
  phone: string;
}
