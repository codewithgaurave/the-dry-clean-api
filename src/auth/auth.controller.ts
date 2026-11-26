import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService, AuthTokensResult } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

/**
 * Authentication Controller handling phone OTP login, token issuance, and rotation.
 * Source of truth: PRD.md §6.1, §10; TECH_STACK.md §4.1; TODO.md TASK-012.
 */
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('otp/request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request 6-digit phone OTP verification code',
    description: 'Enforces rate limit of max 3 requests per 10 minutes per phone number.',
  })
  @ApiResponse({
    status: 200,
    description: 'OTP code generated and dispatched via SMS provider.',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded (more than 3 requests in 10 minutes).',
  })
  async requestOtp(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.phone);
  }

  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify phone OTP and issue JWT access token + rotating refresh token',
  })
  @ApiResponse({
    status: 200,
    description:
      'Authenticated successfully. Returns access token, refresh token, and user profile.',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired OTP code or maximum attempts exceeded.',
  })
  async verifyOtp(@Body() dto: VerifyOtpDto): Promise<AuthTokensResult> {
    return this.authService.verifyOtp(dto.phone, dto.otp);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rotate refresh token and issue new short-lived JWT access token',
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully with new rotating refresh token.',
  })
  @ApiResponse({
    status: 401,
    description: 'Refresh token is invalid, expired, or has already been used.',
  })
  async refreshTokens(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Logout user and revoke refresh token',
  })
  @ApiResponse({
    status: 200,
    description: 'Session terminated and refresh token revoked.',
  })
  async logout(@Body() dto: RefreshTokenDto) {
    return this.authService.logout(dto.refreshToken);
  }
}
