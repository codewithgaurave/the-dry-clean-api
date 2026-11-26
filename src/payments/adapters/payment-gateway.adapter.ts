import { PaymentGateway } from '../../database/schemas/payment.schema';

/**
 * Options for initializing a payment gateway order.
 */
export interface CreateGatewayOrderOptions {
  amountMinor: number;
  currency: string;
  receipt: string; // Internal order tracking ID (e.g. "TC402736")
  notes?: Record<string, string>;
}

/**
 * Result returned from gateway order creation.
 */
export interface GatewayOrderResult {
  gateway: PaymentGateway;
  gatewayOrderId: string;
  amountMinor: number;
  currency: string;
  keyId: string;
  status: string;
  rawResponse?: any;
}

/**
 * Unified Payment Gateway Adapter Contract.
 * Abstracts third-party payment infrastructure (Razorpay, sandbox mock, etc.).
 * Source of truth: PRD.md §6.7 (FR-PAY-1, FR-PAY-6); TECH_STACK.md §4.1, §8.4; TODO.md TASK-026.
 */
export interface PaymentGatewayAdapter {
  readonly gatewayName: PaymentGateway;

  /**
   * Creates an order/intent on the target payment gateway.
   */
  createOrder(options: CreateGatewayOrderOptions): Promise<GatewayOrderResult>;

  /**
   * Verifies payment signature (for client callback confirmation).
   */
  verifySignature(gatewayOrderId: string, gatewayPaymentId: string, signature: string): boolean;

  /**
   * Verifies cryptographic signature for server-to-server webhook callbacks.
   */
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;
}

export const PAYMENT_GATEWAY_ADAPTER = 'PAYMENT_GATEWAY_ADAPTER';
