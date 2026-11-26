import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentGateway, PaymentStatus } from '../../database/schemas/payment.schema';

export class PaymentCustomerDto {
  @ApiPropertyOptional({ example: 'Aditya Sharma' })
  name?: string;

  @ApiPropertyOptional({ example: 'aditya@example.com' })
  email?: string;

  @ApiPropertyOptional({ example: '+919718312383' })
  contact?: string;
}

/**
 * Standard payment initialization response DTO returned to client.
 * Contains gateway order ID and keys needed for SDK checkout popup.
 * Source of truth: PRD.md §6.7; TECH_STACK.md §8.4; TODO.md TASK-026.
 */
export class PaymentIntentResponseDto {
  @ApiProperty({ description: 'MongoDB ObjectId of the Payment record' })
  paymentId: string;

  @ApiProperty({ example: 'TC402736' })
  orderId: string;

  @ApiProperty({ enum: PaymentGateway, example: PaymentGateway.MOCK })
  gateway: PaymentGateway;

  @ApiProperty({
    description: 'Razorpay or Gateway Order ID (e.g. order_mock_TC402736_1730000000)',
    example: 'order_mock_TC402736_1730000000',
  })
  gatewayOrderId: string;

  @ApiProperty({ example: 74340, description: 'Amount in paise' })
  amountMinor: number;

  @ApiProperty({ example: '₹743.40' })
  amountFormatted: string;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({ description: 'Razorpay Key ID needed by mobile checkout' })
  keyId: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.INITIATED })
  status: PaymentStatus;

  @ApiPropertyOptional({ type: PaymentCustomerDto })
  customer?: PaymentCustomerDto;

  @ApiPropertyOptional({ example: 'UPI' })
  paymentMethod?: string;

  @ApiProperty({ description: 'Timestamp when intent was initialized' })
  createdAt: Date;
}
