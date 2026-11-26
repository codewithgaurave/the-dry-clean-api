import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, Matches, Length } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'E.164 formatted phone number',
  })
  @IsNotEmpty({ message: 'Phone number is required.' })
  @Matches(/^\+?[1-9]\d{7,14}$/, {
    message: 'Phone number must be a valid international format.',
  })
  phone: string;

  @ApiProperty({
    example: '123456',
    description: '6-digit OTP verification code',
  })
  @IsNotEmpty({ message: 'OTP is required.' })
  @Length(4, 8, { message: 'OTP must be between 4 and 8 digits.' })
  otp: string;
}
