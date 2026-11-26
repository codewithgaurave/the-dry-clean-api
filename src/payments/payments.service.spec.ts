import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { PaymentsService } from './payments.service';
import { Payment, PaymentStatus, PaymentGateway } from '../database/schemas/payment.schema';
import { Order } from '../database/schemas/order.schema';
import { User } from '../database/schemas/user.schema';
import { OrderStatusEvent } from '../database/schemas/order-status-event.schema';
import { DatabaseService } from '../database/database.service';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { OrderStatus, OrderActorRole } from '../orders/order-status.enum';
import { PAYMENT_GATEWAY_ADAPTER } from './adapters/payment-gateway.adapter';
import { MockPaymentAdapter } from './adapters/mock-payment.adapter';
import { RazorpayPaymentAdapter } from './adapters/razorpay-payment.adapter';
import { CreatePaymentIntentDto } from './dto/create-payment-intent.dto';

describe('PaymentsService', () => {
  let service: PaymentsService;
  let paymentModel: any;
  let orderModel: any;
  let userModel: any;
  let eventModel: any;
  let databaseService: any;
  let outboxPublisher: any;
  let mockAdapter: MockPaymentAdapter;

  const validOrderId = 'TC402736';
  const validOrderDocId = new Types.ObjectId();
  const validUserId = new Types.ObjectId();
  const validGatewayOrderId = 'order_mock_TC402736_123456';
  const validPaymentDocId = new Types.ObjectId();

  const mockOrderDoc = {
    _id: validOrderDocId,
    orderId: validOrderId,
    userId: validUserId,
    status: OrderStatus.PAYMENT_PENDING,
    paymentStatus: 'PENDING',
    paymentMethod: 'UPI',
    pricingSnapshot: {
      subtotalMinor: 70000,
      discountMinor: 7000,
      deliveryFeeMinor: 0,
      totalAmountMinor: 74340,
      currency: 'INR',
    },
    save: jest.fn().mockResolvedValue(true),
  };

  const mockUserDoc = {
    _id: validUserId,
    name: 'Aditya Sharma',
    email: 'aditya@example.com',
    phone: '+919718312383',
  };

  const mockPaymentDoc: any = {
    _id: validPaymentDocId,
    orderId: validOrderId,
    orderRef: validOrderDocId,
    userId: validUserId,
    gateway: PaymentGateway.MOCK,
    gatewayOrderId: validGatewayOrderId,
    amountMinor: 74340,
    currency: 'INR',
    status: PaymentStatus.INITIATED,
    paymentMethod: 'UPI',
    notes: {},
    save: jest.fn().mockResolvedValue(true),
  };

  beforeEach(async () => {
    mockAdapter = new MockPaymentAdapter();

    paymentModel = {
      create: jest.fn().mockImplementation((data) => ({
        _id: new Types.ObjectId(),
        ...data,
        createdAt: new Date(),
      })),
      findById: jest.fn(),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
      findOne: jest.fn().mockReturnValue({
        session: jest
          .fn()
          .mockResolvedValue({ ...mockPaymentDoc, save: jest.fn().mockResolvedValue(true) }),
        sort: jest.fn().mockReturnValue({
          session: jest
            .fn()
            .mockResolvedValue({ ...mockPaymentDoc, save: jest.fn().mockResolvedValue(true) }),
        }),
      }),
    };

    orderModel = {
      findOne: jest.fn().mockImplementation(() => ({
        session: jest
          .fn()
          .mockResolvedValue({ ...mockOrderDoc, save: jest.fn().mockResolvedValue(true) }),
      })),
    };

    userModel = {
      findById: jest.fn().mockResolvedValue(mockUserDoc),
    };

    eventModel = {
      create: jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]),
    };

    databaseService = {
      withTransaction: jest.fn().mockImplementation(async (callback) => {
        return callback({});
      }),
    };

    outboxPublisher = {
      publish: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(OrderStatusEvent.name), useValue: eventModel },
        { provide: DatabaseService, useValue: databaseService },
        { provide: OutboxPublisherService, useValue: outboxPublisher },
        { provide: PAYMENT_GATEWAY_ADAPTER, useValue: mockAdapter },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  describe('createPaymentIntent', () => {
    it('should initialize gateway order, persist payment in INITIATED status, and return checkout tokens', async () => {
      // Direct findOne for order in createPaymentIntent (no session)
      orderModel.findOne = jest.fn().mockResolvedValue(mockOrderDoc);

      const dto: CreatePaymentIntentDto = {
        orderId: validOrderId,
        paymentMethod: 'UPI',
      };

      const result = await service.createPaymentIntent(dto);

      expect(result).toBeDefined();
      expect(result.orderId).toBe(validOrderId);
      expect(result.amountMinor).toBe(74340);
      expect(result.amountFormatted).toBe('₹743.40');
      expect(result.gateway).toBe(PaymentGateway.MOCK);
      expect(result.gatewayOrderId).toMatch(/^order_mock_TC402736_\d+$/);
      expect(result.keyId).toBe('rzp_test_mock_atelier_key');
      expect(result.status).toBe(PaymentStatus.INITIATED);
      expect(result.customer?.name).toBe('Aditya Sharma');

      expect(paymentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: validOrderId,
          orderRef: validOrderDocId,
          userId: validUserId,
          gateway: PaymentGateway.MOCK,
          amountMinor: 74340,
          status: PaymentStatus.INITIATED,
        }),
      );
    });

    it('should throw NotFoundException if order tracking ID does not exist', async () => {
      orderModel.findOne = jest.fn().mockResolvedValue(null);

      await expect(service.createPaymentIntent({ orderId: 'TC999999' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException if order is already marked PAID', async () => {
      orderModel.findOne = jest.fn().mockResolvedValue({
        ...mockOrderDoc,
        paymentStatus: 'PAID',
      });

      await expect(service.createPaymentIntent({ orderId: validOrderId })).rejects.toThrow(
        ConflictException,
      );
    });

    it('should update order paymentMethod when a different method is selected', async () => {
      const orderToUpdate = {
        ...mockOrderDoc,
        paymentMethod: 'UPI',
        save: jest.fn().mockResolvedValue(true),
      };
      orderModel.findOne = jest.fn().mockResolvedValue(orderToUpdate);

      await service.createPaymentIntent({
        orderId: validOrderId,
        paymentMethod: 'CARD',
      });

      expect(orderToUpdate.paymentMethod).toBe('CARD');
      expect(orderToUpdate.save).toHaveBeenCalled();
    });
  });

  describe('processWebhook (TASK-027)', () => {
    const validSignature = 'valid_mock_signature';
    const sampleCapturedPayload = {
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_mock_99999',
            order_id: validGatewayOrderId,
            amount: 74340,
            currency: 'INR',
            status: 'captured',
            notes: { orderId: validOrderId },
          },
        },
      },
    };

    it('should verify signature, update payment to SUCCESSFUL, transition order to CONFIRMED, and emit outbox', async () => {
      const activePayment = {
        ...mockPaymentDoc,
        status: PaymentStatus.INITIATED,
        save: jest.fn().mockResolvedValue(true),
      };
      const activeOrder = {
        ...mockOrderDoc,
        status: OrderStatus.PAYMENT_PENDING,
        paymentStatus: 'PENDING',
        save: jest.fn().mockResolvedValue(true),
      };

      paymentModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(activePayment),
      });
      orderModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(activeOrder),
      });

      const result = await service.processWebhook(sampleCapturedPayload, validSignature);

      expect(result).toBeDefined();
      expect(result.received).toBe(true);
      expect(result.status).toBe('processed');
      expect(result.orderId).toBe(validOrderId);
      expect(result.paymentStatus).toBe(PaymentStatus.SUCCESSFUL);

      // Verify payment marked SUCCESSFUL with gatewayPaymentId and signature
      expect(activePayment.status).toBe(PaymentStatus.SUCCESSFUL);
      expect(activePayment.gatewayPaymentId).toBe('pay_mock_99999');
      expect(activePayment.gatewaySignature).toBe(validSignature);
      expect(activePayment.save).toHaveBeenCalled();

      // Verify order marked PAID and CONFIRMED
      expect(activeOrder.paymentStatus).toBe('PAID');
      expect(activeOrder.status).toBe(OrderStatus.CONFIRMED);
      expect(activeOrder.save).toHaveBeenCalled();

      // Verify immutable OrderStatusEvent recorded
      expect(eventModel.create).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            orderId: validOrderId,
            status: OrderStatus.CONFIRMED,
            updatedBy: expect.objectContaining({
              actorRole: OrderActorRole.SYSTEM,
              actorId: 'PAYMENT_WEBHOOK',
            }),
          }),
        ]),
        expect.anything(),
      );

      // Verify Outbox domain event published
      expect(outboxPublisher.publish).toHaveBeenCalledWith(
        'PAYMENT_CONFIRMED',
        expect.objectContaining({
          orderId: validOrderId,
          gatewayOrderId: validGatewayOrderId,
          gatewayPaymentId: 'pay_mock_99999',
          amountMinor: 74340,
        }),
        expect.anything(),
      );
    });

    it('should reject tampered or invalid webhook signature with 400 Bad Request', async () => {
      await expect(
        service.processWebhook(sampleCapturedPayload, 'invalid_tampered_signature'),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject missing webhook signature with 400 Bad Request', async () => {
      await expect(service.processWebhook(sampleCapturedPayload, '')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should handle idempotent duplicate webhook callbacks without re-transitioning order', async () => {
      const alreadyPaidPayment = {
        ...mockPaymentDoc,
        status: PaymentStatus.SUCCESSFUL,
        save: jest.fn(),
      };
      const alreadyPaidOrder = {
        ...mockOrderDoc,
        status: OrderStatus.CONFIRMED,
        paymentStatus: 'PAID',
        save: jest.fn(),
      };

      paymentModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(alreadyPaidPayment),
      });
      orderModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(alreadyPaidOrder),
      });

      const result = await service.processWebhook(sampleCapturedPayload, validSignature);

      expect(result.received).toBe(true);
      expect(result.status).toBe('already_processed');
      expect(result.isIdempotentReplay).toBe(true);

      // Ensure no double writes
      expect(alreadyPaidPayment.save).not.toHaveBeenCalled();
      expect(alreadyPaidOrder.save).not.toHaveBeenCalled();
      expect(eventModel.create).not.toHaveBeenCalled();
      expect(outboxPublisher.publish).not.toHaveBeenCalled();
    });

    it('should handle payment.failed event and transition order to PAYMENT_FAILED', async () => {
      const activePayment = {
        ...mockPaymentDoc,
        status: PaymentStatus.INITIATED,
        save: jest.fn().mockResolvedValue(true),
      };
      const activeOrder = {
        ...mockOrderDoc,
        status: OrderStatus.PAYMENT_PENDING,
        paymentStatus: 'PENDING',
        save: jest.fn().mockResolvedValue(true),
      };

      paymentModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(activePayment),
      });
      orderModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(activeOrder),
      });

      const failedPayload = {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_123',
              order_id: validGatewayOrderId,
              status: 'failed',
              error_description: 'Card declined by issuing bank',
              notes: { orderId: validOrderId },
            },
          },
        },
      };

      const result = await service.processWebhook(failedPayload, validSignature);

      expect(result.received).toBe(true);
      expect(result.status).toBe('failed');
      expect(result.paymentStatus).toBe(PaymentStatus.FAILED);

      expect(activePayment.status).toBe(PaymentStatus.FAILED);
      expect(activePayment.errorMessage).toBe('Card declined by issuing bank');

      expect(activeOrder.paymentStatus).toBe('FAILED');
      expect(activeOrder.status).toBe(OrderStatus.PAYMENT_FAILED);

      expect(outboxPublisher.publish).toHaveBeenCalledWith(
        'PAYMENT_FAILED',
        expect.objectContaining({
          orderId: validOrderId,
          errorMessage: 'Card declined by issuing bank',
        }),
        expect.anything(),
      );
    });

    it('should gracefully return payment_not_found if payment record does not exist', async () => {
      paymentModel.findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
        sort: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(null),
        }),
      });

      const result = await service.processWebhook(sampleCapturedPayload, validSignature);

      expect(result.received).toBe(true);
      expect(result.status).toBe('payment_not_found');
    });
  });

  describe('Adapters', () => {
    it('MockPaymentAdapter should create order and verify signatures', async () => {
      const order = await mockAdapter.createOrder({
        amountMinor: 50000,
        currency: 'INR',
        receipt: 'TC123456',
      });

      expect(order.gateway).toBe(PaymentGateway.MOCK);
      expect(order.status).toBe('created');
      expect(
        mockAdapter.verifySignature(order.gatewayOrderId, 'pay_123', 'valid_mock_signature'),
      ).toBe(true);
      expect(
        mockAdapter.verifyWebhookSignature(JSON.stringify({ test: true }), 'valid_mock_signature'),
      ).toBe(true);
      expect(
        mockAdapter.verifyWebhookSignature(JSON.stringify({ test: true }), 'tampered_signature'),
      ).toBe(false);
    });

    it('RazorpayPaymentAdapter should throw InternalServerErrorException if credentials are missing', async () => {
      const configService = {
        get: jest.fn().mockReturnValue(''),
      } as unknown as ConfigService;
      const rzpAdapter = new RazorpayPaymentAdapter(configService);

      await expect(
        rzpAdapter.createOrder({
          amountMinor: 50000,
          currency: 'INR',
          receipt: 'TC123456',
        }),
      ).rejects.toThrow();
    });

    it('RazorpayPaymentAdapter should verify HMAC-SHA256 webhook signatures', () => {
      const configService = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'payments.razorpay.webhookSecret') return 'test_secret';
          return 'test_key';
        }),
      } as unknown as ConfigService;
      const rzpAdapter = new RazorpayPaymentAdapter(configService);

      const payload = JSON.stringify({ event: 'payment.captured' });
      const validSig = crypto.createHmac('sha256', 'test_secret').update(payload).digest('hex');

      expect(rzpAdapter.verifyWebhookSignature(payload, validSig)).toBe(true);
      expect(rzpAdapter.verifyWebhookSignature(payload, 'wrong_signature')).toBe(false);
    });
  });

  describe('Lookup Methods', () => {
    it('should retrieve payment by MongoDB ObjectId', async () => {
      const id = new Types.ObjectId().toString();
      const mockPayment = { _id: id, orderId: validOrderId, status: PaymentStatus.INITIATED };
      paymentModel.findById.mockResolvedValue(mockPayment);

      const result = await service.getPaymentById(id);
      expect(result).toBe(mockPayment);
      expect(paymentModel.findById).toHaveBeenCalledWith(id);
    });

    it('should throw BadRequestException if payment ID is invalid ObjectId', async () => {
      await expect(service.getPaymentById('invalid-mongo-id')).rejects.toThrow(BadRequestException);
    });

    it('should retrieve payments by orderId', async () => {
      const mockPayments = [{ orderId: validOrderId }];
      paymentModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPayments),
        }),
      });

      const results = await service.getPaymentsByOrderId(validOrderId);
      expect(results).toEqual(mockPayments);
    });
  });
});
