import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceTokenDto {
  @ApiProperty({
    description: 'Firebase Cloud Messaging (FCM) device registration token',
    example: 'dK1-f9z4_eR8xP2q7vL:APA91bF9aB...',
  })
  @IsNotEmpty()
  @IsString()
  token: string;

  @ApiPropertyOptional({
    description: 'Device operating system platform (android, ios, web)',
    example: 'android',
  })
  @IsOptional()
  @IsString()
  platform?: string;
}
