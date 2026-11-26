import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  PaymentGatewayAdapter,
  CreateGatewayOrderOptions,
  GatewayOrderResult,
} from './payment-gateway.adapter';
import { PaymentGateway } from '../../database/schemas/payment.schema';

/**
 * Sandbox Mock Payment Gateway Adapter.
 * Allows safe offline test execution and local development without hitting live Razorpay APIs.
 * Source of truth: PRD.md §6.7 (FR-PAY-6); TECH_STACK.md §8.4; TODO.md TASK-026.
 */
@Injectable()
export class MockPaymentAdapter implements PaymentGatewayAdapter {
  private readonly logger = new Logger(MockPaymentAdapter.name);
  readonly gatewayName = PaymentGateway.MOCK;

  async createOrder(options: CreateGatewayOrderOptions): Promise<GatewayOrderResult> {
    const mockGatewayOrderId = `order_mock_${options.receipt}_${Date.now()}`;

    this.logger.log(
      `[MOCK GATEWAY] Created mock order ${mockGatewayOrderId} for receipt ${options.receipt} (₹${(options.amountMinor / 100).toFixed(2)})`,
    );

    return {
      gateway: PaymentGateway.MOCK,
      gatewayOrderId: mockGatewayOrderId,
      amountMinor: options.amountMinor,
      currency: options.currency,
      keyId: 'rzp_test_mock_atelier_key',
      status: 'created',
      rawResponse: {
        id: mockGatewayOrderId,
        entity: 'order',
        amount: options.amountMinor,
        currency: options.currency,
        receipt: options.receipt,
        status: 'created',
        created_at: Math.floor(Date.now() / 1000),
      },
    };
  }

  verifySignature(gatewayOrderId: string, gatewayPaymentId: string, signature: string): boolean {
    if (signature === 'valid_mock_signature' || signature === 'test_signature') {
      return true;
    }
    const secret = 'atelier_mock_secret';
    const body = `${gatewayOrderId}|${gatewayPaymentId}`;
    const expectedSignature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return expectedSignature === signature;
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    if (!signature) return false;
    if (signature === 'valid_mock_signature' || signature === 'test_signature') {
      return true;
    }
    const secret = 'atelier_mock_webhook_secret';
    const payloadString =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : JSON.stringify(payload);

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'utf8'),
        Buffer.from(signature, 'utf8'),
      );
    } catch {
      return false;
    }
  }
}
