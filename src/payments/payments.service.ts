import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentDocument, PaymentStatus } from '../database/schemas/payment.schema';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import { User, UserDocument } from '../database/schemas/user.schema';
import {
  OrderStatusEvent,
  OrderStatusEventDocument,
} from '../database/schemas/order-status-event.schema';
import { DatabaseService } from '../database/database.service';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { OrderStatus, OrderActorRole } from '../orders/order-status.enum';
import { PAYMENT_GATEWAY_ADAPTER, PaymentGatewayAdapter } from './adapters/payment-gateway.adapter';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';
import { PaymentIntentResponseDto, PaymentCustomerDto } from './dto/payment-intent-response.dto';

export interface WebhookProcessingResult {
  received: boolean;
  status: string;
  orderId?: string;
  paymentStatus?: string;
  isIdempotentReplay?: boolean;
}

/**
 * Payments Service.
 * Manages payment order initialization, gateway abstraction, webhook processing, and transaction auditing.
 * Source of truth: PRD.md §6.7 (FR-PAY-1, FR-PAY-2, FR-PAY-3, FR-PAY-4); TECH_STACK.md §4.1, §7.2, §8.4; TODO.md TASK-026, TASK-027.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(OrderStatusEvent.name)
    private readonly eventModel: Model<OrderStatusEventDocument>,
    private readonly databaseService: DatabaseService,
    private readonly outboxPublisher: OutboxPublisherService,
    @Inject(PAYMENT_GATEWAY_ADAPTER)
    private readonly gatewayAdapter: PaymentGatewayAdapter,
  ) {}

  /**
   * Initializes a payment intent linked to an existing order.
   */
  async createPaymentIntent(
    dto: CreatePaymentIntentDto,
    currentUser?: any,
    idempotencyKey?: string,
  ): Promise<PaymentIntentResponseDto> {
    const cleanOrderId = dto.orderId.trim();

    // 1. Locate Order record
    const order = await this.orderModel.findOne({ orderId: cleanOrderId });
    if (!order) {
      throw new NotFoundException(`Order not found with tracking ID: ${cleanOrderId}`);
    }

    // 2. Verify Order is payable
    if (order.paymentStatus === 'PAID') {
      throw new ConflictException(`Order #${cleanOrderId} has already been paid in full.`);
    }

    // 3. User Ownership check (if authenticated)
    if (currentUser?._id && order.userId) {
      const currentUserIdStr = currentUser._id.toString();
      const orderUserIdStr = order.userId.toString();
      // Allow if current user matches order owner, or is staff/admin
      if (
        currentUserIdStr !== orderUserIdStr &&
        currentUser.role !== 'ADMIN' &&
        currentUser.role !== 'OPS'
      ) {
        this.logger.warn(
          `User ${currentUserIdStr} attempted payment on unowned order ${cleanOrderId}`,
        );
      }
    }

    // 4. Resolve customer contact metadata
    let customer: PaymentCustomerDto | undefined;
    if (currentUser) {
      customer = {
        name: currentUser.name,
        email: currentUser.email,
        contact: currentUser.phone,
      };
    } else if (order.userId) {
      const orderUser = await this.userModel.findById(order.userId);
      if (orderUser) {
        customer = {
          name: orderUser.name,
          email: orderUser.email,
          contact: orderUser.phone,
        };
      }
    }

    const amountMinor = order.pricingSnapshot.totalAmountMinor;
    const currency = order.pricingSnapshot.currency || 'INR';

    // 5. Delegate to Gateway Adapter
    const gatewayResult = await this.gatewayAdapter.createOrder({
      amountMinor,
      currency,
      receipt: cleanOrderId,
      notes: {
        orderId: cleanOrderId,
        method: dto.paymentMethod || order.paymentMethod || 'UPI',
        ifProvidedKey: idempotencyKey || 'none',
      },
    });

    // 6. Record Payment Document
    const payment = await this.paymentModel.create({
      orderId: cleanOrderId,
      orderRef: order._id,
      userId: order.userId,
      gateway: gatewayResult.gateway,
      gatewayOrderId: gatewayResult.gatewayOrderId,
      amountMinor,
      currency,
      status: PaymentStatus.INITIATED,
      paymentMethod: dto.paymentMethod || order.paymentMethod || 'UPI',
      notes: {
        receipt: cleanOrderId,
        gatewayStatus: gatewayResult.status,
      },
    });

    // 7. Update order's paymentMethod if explicitly supplied
    if (dto.paymentMethod && dto.paymentMethod !== order.paymentMethod) {
      order.paymentMethod = dto.paymentMethod;
      await order.save();
    }

    this.logger.log(
      `Payment intent created: ${payment._id} (Gateway Order: ${gatewayResult.gatewayOrderId}) for Order #${cleanOrderId}`,
    );

    return {
      paymentId: payment._id.toString(),
      orderId: cleanOrderId,
      gateway: gatewayResult.gateway,
      gatewayOrderId: gatewayResult.gatewayOrderId,
      amountMinor,
      amountFormatted: `₹${(amountMinor / 100).toFixed(2)}`,
      currency,
      keyId: gatewayResult.keyId,
      status: PaymentStatus.INITIATED,
      customer,
      paymentMethod: payment.paymentMethod,
      createdAt: payment.createdAt || new Date(),
    };
  }

  /**
   * Verifies cryptographic signature and idempotently processes payment gateway webhook callbacks.
   * Atomically transitions order status to CONFIRMED, records payment transaction update,
   * creates an immutable status timeline event, and enqueues domain events into the transactional Outbox.
   * Source of truth: PRD.md §6.7 (FR-PAY-3, FR-PAY-4); TECH_STACK.md §4.1, §7.2; TODO.md TASK-027.
   */
  async processWebhook(rawPayload: any, signature: string): Promise<WebhookProcessingResult> {
    // 1. Verify cryptographic signature
    if (!signature || signature.trim().length === 0) {
      this.logger.warn('Webhook rejected: Missing cryptographic signature.');
      throw new BadRequestException('Missing webhook signature.');
    }

    const isValid = this.gatewayAdapter.verifyWebhookSignature(rawPayload, signature);
    if (!isValid) {
      this.logger.warn(`Webhook rejected: Invalid signature (${signature}).`);
      throw new BadRequestException('Invalid webhook cryptographic signature.');
    }

    // 2. Parse payload safely
    let body: any;
    if (Buffer.isBuffer(rawPayload)) {
      try {
        body = JSON.parse(rawPayload.toString('utf8'));
      } catch {
        throw new BadRequestException('Invalid JSON payload in webhook body.');
      }
    } else if (typeof rawPayload === 'string') {
      try {
        body = JSON.parse(rawPayload);
      } catch {
        throw new BadRequestException('Invalid JSON payload in webhook body.');
      }
    } else {
      body = rawPayload;
    }

    const eventType: string =
      body.event || (body.status === 'FAILED' ? 'payment.failed' : 'payment.captured');
    const paymentEntity = body.payload?.payment?.entity || body;
    const orderEntity = body.payload?.order?.entity;

    const gatewayOrderId: string | undefined =
      paymentEntity.order_id || orderEntity?.id || body.gatewayOrderId;
    const gatewayPaymentId: string | undefined = paymentEntity.id || body.gatewayPaymentId;
    const explicitOrderId: string | undefined =
      paymentEntity.notes?.orderId || orderEntity?.receipt || body.orderId;
    const errorDescription: string | undefined =
      paymentEntity.error_description ||
      paymentEntity.error_reason ||
      body.errorMessage ||
      body.errorDescription;

    // 3. Process idempotently within ACID session transaction
    return this.databaseService.withTransaction(async (session) => {
      // Find matching payment record
      let payment: PaymentDocument | null = null;
      if (gatewayOrderId) {
        payment = await this.paymentModel.findOne({ gatewayOrderId }).session(session);
      }
      if (!payment && explicitOrderId) {
        payment = await this.paymentModel
          .findOne({ orderId: explicitOrderId })
          .sort({ createdAt: -1 })
          .session(session);
      }

      if (!payment) {
        this.logger.warn(
          `Webhook event '${eventType}' received for non-existent payment (gatewayOrderId: ${gatewayOrderId}, orderId: ${explicitOrderId})`,
        );
        return {
          received: true,
          status: 'payment_not_found',
          orderId: explicitOrderId,
        };
      }

      const isCaptureEvent =
        eventType === 'payment.captured' ||
        eventType === 'order.paid' ||
        body.status === 'SUCCESSFUL' ||
        paymentEntity.status === 'captured';

      const isFailedEvent =
        eventType === 'payment.failed' ||
        body.status === 'FAILED' ||
        paymentEntity.status === 'failed';

      // 4. Idempotency Check (FR-PAY-4: Duplicate callback handling)
      if (isCaptureEvent && payment.status === PaymentStatus.SUCCESSFUL) {
        this.logger.log(
          `Idempotent replay detected for Payment ${payment._id} (${payment.gatewayOrderId})`,
        );
        return {
          received: true,
          status: 'already_processed',
          isIdempotentReplay: true,
          orderId: payment.orderId,
          paymentStatus: payment.status,
        };
      }

      if (isFailedEvent && payment.status === PaymentStatus.FAILED) {
        this.logger.log(`Idempotent replay detected for failed Payment ${payment._id}`);
        return {
          received: true,
          status: 'already_processed',
          isIdempotentReplay: true,
          orderId: payment.orderId,
          paymentStatus: payment.status,
        };
      }

      // 5. Handle Payment Capture / Success
      if (isCaptureEvent) {
        payment.status = PaymentStatus.SUCCESSFUL;
        if (gatewayPaymentId) {
          payment.gatewayPaymentId = gatewayPaymentId;
        }
        payment.gatewaySignature = signature;
        payment.notes = {
          ...payment.notes,
          capturedAt: new Date(),
          webhookEvent: eventType,
        };
        await payment.save({ session });

        // Locate and confirm order
        const order = await this.orderModel.findOne({ orderId: payment.orderId }).session(session);

        if (order) {
          const previousStatus = order.status;
          order.paymentStatus = 'PAID';
          if (order.status === OrderStatus.PAYMENT_PENDING || order.status === OrderStatus.DRAFT) {
            order.status = OrderStatus.CONFIRMED;
          }
          await order.save({ session });

          // Append immutable OrderStatusEvent audit entry
          await this.eventModel.create(
            [
              {
                orderId: order.orderId,
                orderRef: order._id,
                previousStatus,
                status: order.status,
                updatedBy: {
                  actorRole: OrderActorRole.SYSTEM,
                  actorId: 'PAYMENT_WEBHOOK',
                  name: 'Payment Gateway Webhook',
                },
                timestamp: new Date(),
                note: `Payment captured via webhook (${payment.gatewayPaymentId || payment.gatewayOrderId})`,
                metadata: {
                  gateway: payment.gateway,
                  gatewayOrderId: payment.gatewayOrderId,
                  gatewayPaymentId: payment.gatewayPaymentId,
                  amountMinor: payment.amountMinor,
                },
              },
            ],
            { session },
          );

          // Write domain event to transactional outbox
          await this.outboxPublisher.publish(
            'PAYMENT_CONFIRMED',
            {
              paymentId: payment._id,
              orderId: order.orderId,
              orderRef: order._id,
              amountMinor: payment.amountMinor,
              currency: payment.currency,
              gatewayOrderId: payment.gatewayOrderId,
              gatewayPaymentId: payment.gatewayPaymentId,
              confirmedAt: new Date(),
            },
            session,
          );

          this.logger.log(
            `Order #${order.orderId} successfully transitioned to CONFIRMED via webhook (Payment ${payment._id})`,
          );
        }

        return {
          received: true,
          status: 'processed',
          orderId: payment.orderId,
          paymentStatus: payment.status,
        };
      }

      // 6. Handle Payment Failure
      if (isFailedEvent) {
        payment.status = PaymentStatus.FAILED;
        payment.errorMessage = errorDescription || 'Payment capture failed at gateway';
        payment.notes = {
          ...payment.notes,
          failedAt: new Date(),
          webhookEvent: eventType,
        };
        await payment.save({ session });

        const order = await this.orderModel.findOne({ orderId: payment.orderId }).session(session);

        if (order && order.paymentStatus !== 'PAID') {
          const previousStatus = order.status;
          order.paymentStatus = 'FAILED';
          if (order.status === OrderStatus.PAYMENT_PENDING) {
            order.status = OrderStatus.PAYMENT_FAILED;
          }
          await order.save({ session });

          await this.eventModel.create(
            [
              {
                orderId: order.orderId,
                orderRef: order._id,
                previousStatus,
                status: order.status,
                updatedBy: {
                  actorRole: OrderActorRole.SYSTEM,
                  actorId: 'PAYMENT_WEBHOOK',
                  name: 'Payment Gateway Webhook',
                },
                timestamp: new Date(),
                note: `Payment failed: ${payment.errorMessage}`,
                metadata: {
                  gateway: payment.gateway,
                  gatewayOrderId: payment.gatewayOrderId,
                  error: payment.errorMessage,
                },
              },
            ],
            { session },
          );

          await this.outboxPublisher.publish(
            'PAYMENT_FAILED',
            {
              paymentId: payment._id,
              orderId: order.orderId,
              orderRef: order._id,
              gatewayOrderId: payment.gatewayOrderId,
              errorMessage: payment.errorMessage,
              failedAt: new Date(),
            },
            session,
          );

          this.logger.warn(
            `Order #${order.orderId} marked PAYMENT_FAILED via webhook: ${payment.errorMessage}`,
          );
        }

        return {
          received: true,
          status: 'failed',
          orderId: payment.orderId,
          paymentStatus: payment.status,
        };
      }

      return {
        received: true,
        status: 'unhandled_event',
        orderId: payment.orderId,
        paymentStatus: payment.status,
      };
    });
  }

  /**
   * Retrieves payment transaction by MongoDB ObjectId.
   */
  async getPaymentById(paymentId: string): Promise<PaymentDocument | null> {
    if (!Types.ObjectId.isValid(paymentId)) {
      throw new BadRequestException(`Invalid payment ID: ${paymentId}`);
    }
    return this.paymentModel.findById(paymentId);
  }

  /**
   * Retrieves all payment transactions recorded for a given orderId.
   */
  async getPaymentsByOrderId(orderId: string): Promise<PaymentDocument[]> {
    return this.paymentModel.find({ orderId }).sort({ createdAt: -1 }).exec();
  }
}
