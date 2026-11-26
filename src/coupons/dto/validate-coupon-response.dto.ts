import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CouponDiscountType } from '../../database/schemas/coupon.schema';

/**
 * Response payload returned upon authoritative coupon validation.
 * Source of truth: PRD.md §6.5 (FR-PR-3, FR-PR-4); TECH_STACK.md §7.2; TODO.md TASK-023.
 */
export class ValidateCouponResponseDto {
  @ApiProperty({
    description: 'Whether the coupon was successfully validated and applied',
    example: true,
  })
  isValid: boolean;

  @ApiProperty({
    description: 'Normalized coupon code',
    example: 'WELCOME10',
  })
  code: string;

  @ApiProperty({
    description: 'Coupon promotional title',
    example: 'Welcome Offer: 10% OFF',
  })
  title: string;

  @ApiPropertyOptional({
    description: 'Description of coupon terms and conditions',
    example: '10% off up to ₹150 on dry cleaning orders above ₹300',
  })
  description?: string;

  @ApiProperty({
    description: 'Type of discount (PERCENTAGE or FLAT)',
    enum: CouponDiscountType,
    example: CouponDiscountType.PERCENTAGE,
  })
  discountType: CouponDiscountType;

  @ApiProperty({
    description: 'Discount value (percentage rate or flat amount in minor units)',
    example: 10,
  })
  discountValue: number;

  @ApiPropertyOptional({
    description: 'Maximum discount cap in minor units (paise) for percentage discounts',
    example: 15000,
  })
  maxDiscountMinor?: number;

  @ApiProperty({
    description: 'Calculated savings discount in minor units (paise)',
    example: 4500,
  })
  discountMinor: number;

  @ApiProperty({
    description: 'Human-readable formatted discount string',
    example: '₹45.00',
  })
  discountFormatted: string;

  @ApiProperty({
    description: 'Net subtotal after applying coupon discount in minor units',
    example: 40500,
  })
  newSubtotalMinor: number;

  @ApiProperty({
    description: 'Formatted net subtotal string',
    example: '₹405.00',
  })
  newSubtotalFormatted: string;

  @ApiProperty({
    description: 'Descriptive validation success message',
    example: 'Coupon "WELCOME10" applied! You save ₹45.00.',
  })
  message: string;
}
