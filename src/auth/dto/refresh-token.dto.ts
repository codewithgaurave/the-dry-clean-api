import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    example: 'd8c2e91a0c4f82b7...',
    description: 'Rotating refresh token',
  })
  @IsNotEmpty({ message: 'Refresh token is required.' })
  @IsString()
  refreshToken: string;
}
