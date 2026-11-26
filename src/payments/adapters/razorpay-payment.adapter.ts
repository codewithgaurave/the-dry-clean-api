import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  PaymentGatewayAdapter,
  CreateGatewayOrderOptions,
  GatewayOrderResult,
} from './payment-gateway.adapter';
import { PaymentGateway } from '../../database/schemas/payment.schema';

/**
 * Production Razorpay Orders API Adapter.
 * Communicates directly with Razorpay REST API without external wrapper dependencies.
 * Source of truth: TECH_STACK.md §4.1, §8.4; PRD.md §6.7; TODO.md TASK-026.
 */
@Injectable()
export class RazorpayPaymentAdapter implements PaymentGatewayAdapter {
  private readonly logger = new Logger(RazorpayPaymentAdapter.name);
  readonly gatewayName = PaymentGateway.RAZORPAY;
  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly apiBaseUrl = 'https://api.razorpay.com/v1';

  constructor(private readonly configService: ConfigService) {
    this.keyId = this.configService.get<string>('payments.razorpay.keyId') || '';
    this.keySecret = this.configService.get<string>('payments.razorpay.keySecret') || '';
  }

  async createOrder(options: CreateGatewayOrderOptions): Promise<GatewayOrderResult> {
    if (!this.keyId || !this.keySecret) {
      this.logger.error('Razorpay API keys not configured in environment');
      throw new InternalServerErrorException('Razorpay credentials unconfigured.');
    }

    const authHeader = `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')}`;

    try {
      const response = await fetch(`${this.apiBaseUrl}/orders`, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: options.amountMinor,
          currency: options.currency,
          receipt: options.receipt,
          notes: options.notes || {},
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.error(
          `Razorpay createOrder failed with status ${response.status}: ${errorBody}`,
        );
        throw new InternalServerErrorException('Failed to initialize payment gateway order.');
      }

      const data = (await response.json()) as any;

      return {
        gateway: PaymentGateway.RAZORPAY,
        gatewayOrderId: data.id,
        amountMinor: data.amount,
        currency: data.currency,
        keyId: this.keyId,
        status: data.status,
        rawResponse: data,
      };
    } catch (err: any) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(`Network error calling Razorpay API: ${err.message}`, err.stack);
      throw new InternalServerErrorException('Unable to reach payment gateway service.');
    }
  }

  verifySignature(gatewayOrderId: string, gatewayPaymentId: string, signature: string): boolean {
    if (!this.keySecret || !signature) return false;
    const body = `${gatewayOrderId}|${gatewayPaymentId}`;
    const expectedSignature = crypto
      .createHmac('sha256', this.keySecret)
      .update(body)
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

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    const webhookSecret =
      this.configService.get<string>('payments.razorpay.webhookSecret') || this.keySecret;
    if (!webhookSecret || !signature) return false;

    const payloadString =
      typeof payload === 'string'
        ? payload
        : Buffer.isBuffer(payload)
          ? payload.toString('utf8')
          : JSON.stringify(payload);

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
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
