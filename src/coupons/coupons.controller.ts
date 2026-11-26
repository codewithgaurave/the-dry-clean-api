import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { CouponsService } from './coupons.service';
import { ValidateCouponDto } from './dto/validate-coupon.dto';
import { ValidateCouponResponseDto } from './dto/validate-coupon-response.dto';

/**
 * Promotional Coupons & Offers Controller.
 * Provides endpoints for checking coupon eligibility and browsing active promotions.
 * Source of truth: PRD.md §6.5 (FR-PR-3, FR-PR-4), §10; TODO.md TASK-023.
 */
@ApiTags('Coupons')
@Controller('coupons')
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Validate promotional coupon code',
    description:
      'Authoritatively verifies coupon existence, validity dates, order minimums, category restrictions, and usage limits.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Coupon is valid and verified. Returns calculated discount amount.',
    type: ValidateCouponResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid coupon, expired code, subtotal below minimum, or category restriction mismatch.',
  })
  async validateCoupon(@Body() dto: ValidateCouponDto): Promise<ValidateCouponResponseDto> {
    return this.couponsService.validateCoupon(dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List available promotional offers',
    description:
      'Retrieves all active unexpired coupons for promotional display and user checkout selection.',
  })
  @ApiQuery({
    name: 'category',
    required: false,
    description: 'Filter coupons applicable to a specific service category',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'List of active promotional coupons.',
  })
  async getActiveCoupons(@Query('category') category?: string) {
    return this.couponsService.listActiveCoupons(category);
  }
}
