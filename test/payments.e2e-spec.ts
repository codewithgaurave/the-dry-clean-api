import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { MockPaymentAdapter } from '../src/payments/adapters/mock-payment.adapter';
import { PAYMENT_GATEWAY_ADAPTER } from '../src/payments/adapters/payment-gateway.adapter';
import { Payment, PaymentStatus, PaymentGateway } from '../src/database/schemas/payment.schema';
import { Order } from '../src/database/schemas/order.schema';
import { User } from '../src/database/schemas/user.schema';
import { OrderStatusEvent } from '../src/database/schemas/order-status-event.schema';
import { DatabaseService } from '../src/database/database.service';
import { OutboxPublisherService } from '../src/outbox/outbox-publisher.service';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('PaymentsController (e2e)', () => {
  let app: INestApplication;

  const validOrderId = 'TC402736';
  const validOrderDocId = new Types.ObjectId();
  const validUserId = new Types.ObjectId();

  const mockOrderDoc: any = {
    _id: validOrderDocId,
    orderId: validOrderId,
    userId: validUserId,
    status: 'PAYMENT_PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: 'UPI',
    pricingSnapshot: {
      subtotalMinor: 70000,
      discountMinor: 7000,
      deliveryFeeMinor: 0,
      totalAmountMinor: 74340,
      currency: 'INR',
    },
    save: jest.fn().mockImplementation(function (this: any) {
      return Promise.resolve(this);
    }),
  };

  const mockPaidOrderDoc = {
    _id: new Types.ObjectId(),
    orderId: 'TC888888',
    userId: validUserId,
    status: 'CONFIRMED',
    paymentStatus: 'PAID',
    pricingSnapshot: {
      subtotalMinor: 50000,
      discountMinor: 0,
      deliveryFeeMinor: 0,
      totalAmountMinor: 59000,
      currency: 'INR',
    },
  };

  const mockUserDoc = {
    _id: validUserId,
    name: 'Aditya Sharma',
    email: 'aditya@example.com',
    phone: '+919718312383',
  };

  const inMemoryPayments: any[] = [];
  const eventModelCreateMock = jest.fn().mockResolvedValue([{ _id: new Types.ObjectId() }]);
  const outboxPublishMock = jest.fn().mockResolvedValue({});

  beforeAll(async () => {
    const paymentModel = {
      create: jest.fn().mockImplementation((data) => {
        const doc = {
          _id: new Types.ObjectId(),
          ...data,
          createdAt: new Date(),
          save: jest.fn().mockImplementation(function (this: any) {
            return Promise.resolve(this);
          }),
        };
        inMemoryPayments.push(doc);
        return Promise.resolve(doc);
      }),
      findById: jest.fn().mockImplementation((id: string) => {
        const found = inMemoryPayments.find((p) => p._id.toString() === id);
        return Promise.resolve(found || null);
      }),
      find: jest.fn().mockImplementation((query: any) => ({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockImplementation(() => {
            const matches = inMemoryPayments.filter((p) => p.orderId === query.orderId);
            return Promise.resolve(matches);
          }),
        }),
      })),
      findOne: jest.fn().mockImplementation((query: any) => {
        const found =
          inMemoryPayments.find(
            (p) =>
              (query.gatewayOrderId && p.gatewayOrderId === query.gatewayOrderId) ||
              (query.orderId && p.orderId === query.orderId),
          ) || null;
        return {
          session: jest.fn().mockResolvedValue(found),
          sort: jest.fn().mockReturnValue({
            session: jest.fn().mockResolvedValue(found),
          }),
          then: (resolve: any, reject: any) => Promise.resolve(found).then(resolve, reject),
        };
      }),
    };

    const orderModel = {
      findOne: jest.fn().mockImplementation((query: any) => {
        let doc: any = null;
        if (query.orderId === validOrderId) doc = mockOrderDoc;
        else if (query.orderId === 'TC888888') doc = mockPaidOrderDoc;
        return {
          session: jest.fn().mockResolvedValue(doc),
          then: (resolve: any, reject: any) => Promise.resolve(doc).then(resolve, reject),
        };
      }),
    };

    const userModel = {
      findById: jest.fn().mockResolvedValue(mockUserDoc),
    };

    const mockAdapter = new MockPaymentAdapter();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        PaymentsService,
        { provide: getModelToken(Payment.name), useValue: paymentModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(User.name), useValue: userModel },
        {
          provide: getModelToken(OrderStatusEvent.name),
          useValue: { create: eventModelCreateMock },
        },
        {
          provide: DatabaseService,
          useValue: { withTransaction: jest.fn().mockImplementation((cb) => cb({})) },
        },
        { provide: OutboxPublisherService, useValue: { publish: outboxPublishMock } },
        { provide: PAYMENT_GATEWAY_ADAPTER, useValue: mockAdapter },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /v1/payments/intent', () => {
    it('should initialize payment intent and return checkout tokens for payable order', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments/intent')
        .send({
          orderId: validOrderId,
          paymentMethod: 'UPI',
        })
        .expect(HttpStatus.OK);

      expect(response.body).toBeDefined();
      expect(response.body.orderId).toBe(validOrderId);
      expect(response.body.amountMinor).toBe(74340);
      expect(response.body.amountFormatted).toBe('₹743.40');
      expect(response.body.gateway).toBe(PaymentGateway.MOCK);
      expect(response.body.gatewayOrderId).toMatch(/^order_mock_TC402736_\d+$/);
      expect(response.body.keyId).toBe('rzp_test_mock_atelier_key');
      expect(response.body.status).toBe(PaymentStatus.INITIATED);
      expect(response.body.paymentId).toBeDefined();
      expect(response.body.customer?.name).toBe('Aditya Sharma');

      expect(inMemoryPayments.length).toBe(1);
    });

    it('should return 404 when orderId does not exist', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments/intent')
        .send({ orderId: 'TC000000' })
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.statusCode).toBe(404);
      expect(response.body.message).toContain('Order not found');
    });

    it('should return 409 Conflict when order is already paid in full', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments/intent')
        .send({ orderId: 'TC888888' })
        .expect(HttpStatus.CONFLICT);

      expect(response.body.statusCode).toBe(409);
      expect(response.body.message).toContain('already been paid in full');
    });
  });

  describe('POST /v1/payments/webhook (TASK-027)', () => {
    it('should reject webhook without signature header with 400 Bad Request', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .send({ event: 'payment.captured' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toContain('signature');
    });

    it('should reject webhook with invalid/tampered signature with 400 Bad Request', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('x-razorpay-signature', 'tampered_signature_123')
        .send({ event: 'payment.captured' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toContain('Invalid webhook cryptographic signature');
    });

    it('should process payment.captured with valid signature, confirm order, and publish outbox', async () => {
      const createdPayment = inMemoryPayments[0];
      expect(createdPayment).toBeDefined();

      const webhookPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_mock_123456',
              order_id: createdPayment.gatewayOrderId,
              amount: 74340,
              currency: 'INR',
              status: 'captured',
              notes: { orderId: validOrderId },
            },
          },
        },
      };

      const response = await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('x-razorpay-signature', 'valid_mock_signature')
        .send(webhookPayload)
        .expect(HttpStatus.OK);

      expect(response.body.received).toBe(true);
      expect(response.body.status).toBe('processed');
      expect(response.body.orderId).toBe(validOrderId);
      expect(response.body.paymentStatus).toBe(PaymentStatus.SUCCESSFUL);

      // Verify payment updated in-memory
      expect(createdPayment.status).toBe(PaymentStatus.SUCCESSFUL);
      expect(createdPayment.gatewayPaymentId).toBe('pay_rzp_mock_123456');

      // Verify order updated
      expect(mockOrderDoc.paymentStatus).toBe('PAID');
      expect(mockOrderDoc.status).toBe('CONFIRMED');

      // Verify immutable event recorded
      expect(eventModelCreateMock).toHaveBeenCalled();
      // Verify outbox message emitted
      expect(outboxPublishMock).toHaveBeenCalledWith(
        'PAYMENT_CONFIRMED',
        expect.objectContaining({
          orderId: validOrderId,
          gatewayPaymentId: 'pay_rzp_mock_123456',
        }),
        expect.anything(),
      );
    });

    it('should idempotently handle duplicate webhook delivery without double processing', async () => {
      const createdPayment = inMemoryPayments[0];

      const webhookPayload = {
        event: 'payment.captured',
        payload: {
          payment: {
            entity: {
              id: 'pay_rzp_mock_123456',
              order_id: createdPayment.gatewayOrderId,
              amount: 74340,
              currency: 'INR',
              status: 'captured',
            },
          },
        },
      };

      const eventCallsBefore = eventModelCreateMock.mock.calls.length;
      const outboxCallsBefore = outboxPublishMock.mock.calls.length;

      const response = await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('x-razorpay-signature', 'valid_mock_signature')
        .send(webhookPayload)
        .expect(HttpStatus.OK);

      expect(response.body.received).toBe(true);
      expect(response.body.status).toBe('already_processed');
      expect(response.body.isIdempotentReplay).toBe(true);

      // Verify no extra status events or outbox events on duplicate callback
      expect(eventModelCreateMock.mock.calls.length).toBe(eventCallsBefore);
      expect(outboxPublishMock.mock.calls.length).toBe(outboxCallsBefore);
    });

    it('should process payment.failed webhook event and mark order PAYMENT_FAILED', async () => {
      // Create another payment for testing failure
      const failOrderId = 'TC555555';
      const failOrderDoc = {
        _id: new Types.ObjectId(),
        orderId: failOrderId,
        status: 'PAYMENT_PENDING',
        paymentStatus: 'PENDING',
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };

      const failPaymentDoc = {
        _id: new Types.ObjectId(),
        orderId: failOrderId,
        gatewayOrderId: 'order_mock_TC555555_fail',
        status: PaymentStatus.INITIATED,
        notes: {},
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };
      inMemoryPayments.push(failPaymentDoc);

      // Temporarily mock findOne for failOrderDoc
      const origFindOne = app.get<any>(getModelToken(Order.name)).findOne;
      app.get<any>(getModelToken(Order.name)).findOne = jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(failOrderDoc),
      });

      const failedPayload = {
        event: 'payment.failed',
        payload: {
          payment: {
            entity: {
              id: 'pay_failed_test',
              order_id: 'order_mock_TC555555_fail',
              status: 'failed',
              error_description: 'Transaction declined by bank',
            },
          },
        },
      };

      const response = await request(app.getHttpServer())
        .post('/v1/payments/webhook')
        .set('x-razorpay-signature', 'valid_mock_signature')
        .send(failedPayload)
        .expect(HttpStatus.OK);

      expect(response.body.received).toBe(true);
      expect(response.body.status).toBe('failed');
      expect(failPaymentDoc.status).toBe(PaymentStatus.FAILED);
      expect(failOrderDoc.status).toBe('PAYMENT_FAILED');
      expect(failOrderDoc.paymentStatus).toBe('FAILED');

      expect(outboxPublishMock).toHaveBeenCalledWith(
        'PAYMENT_FAILED',
        expect.objectContaining({
          orderId: failOrderId,
          errorMessage: 'Transaction declined by bank',
        }),
        expect.anything(),
      );

      // Restore
      app.get<any>(getModelToken(Order.name)).findOne = origFindOne;
    });
  });

  describe('GET /v1/payments/:id & GET /v1/payments/order/:orderId', () => {
    it('should retrieve existing payment record by ID', async () => {
      const createdPayment = inMemoryPayments[0];
      const response = await request(app.getHttpServer())
        .get(`/v1/payments/${createdPayment._id.toString()}`)
        .expect(HttpStatus.OK);

      expect(response.body._id).toBe(createdPayment._id.toString());
      expect(response.body.orderId).toBe(validOrderId);
      expect(response.body.status).toBe(PaymentStatus.SUCCESSFUL);
    });

    it('should return 404 for non-existent payment ID', async () => {
      const randomId = new Types.ObjectId().toString();
      await request(app.getHttpServer())
        .get(`/v1/payments/${randomId}`)
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should retrieve payments list for valid orderId', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/payments/order/${validOrderId}`)
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(1);
      expect(response.body[0].orderId).toBe(validOrderId);
    });
  });
});
