import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PricingService } from './pricing.service';
import { QuoteRequestDto } from './dto/quote-request.dto';
import { QuoteResponseDto } from './dto/quote-response.dto';

/**
 * Quotation & Pricing Controller.
 * Computes authoritative pricing quotations, GST breakdown, free delivery thresholds, and discounts.
 * Source of truth: PRD.md §6.5, §10; TECH_STACK.md §7.2; TODO.md TASK-018.
 */
@ApiTags('Pricing')
@Controller()
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post(['pricing/quote', 'bookings/quote'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Calculate authoritative price quotation',
    description:
      'Computes item subtotal, add-on costs, coupon discounts, delivery fees, and 18% GST with minor integer precision.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Detailed quotation breakdown with verified item pricing.',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input payload, missing items, or pricing not configured.',
  })
  async getQuote(@Body() dto: QuoteRequestDto): Promise<QuoteResponseDto> {
    return this.pricingService.calculateQuote(dto);
  }
}
