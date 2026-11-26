import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';

import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { BookingsController } from '../src/bookings/bookings.controller';
import { BookingsService } from '../src/bookings/bookings.service';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';
import { AgentTasksController } from '../src/agent/agent-tasks.controller';
import { AgentTasksService } from '../src/agent/agent-tasks.service';
import { AdminOrdersController } from '../src/orders/admin-orders.controller';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';

import { User } from '../src/database/schemas/user.schema';
import { OrderStatus, OrderActorRole } from '../src/orders/order-status.enum';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { RolesGuard } from '../src/auth/guards/roles.guard';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

/**
 * End-to-End Full Customer Journey Test Suite.
 * Covers: Auth → Quote → Booking → Payment Webhook → Agent Proof Upload → Facility Processing → Delivery Confirmation.
 * Source of truth: TECH_STACK.md §12.1; PRD.md §16.1; TODO.md TASK-047.
 */
describe('Full Customer Journey E2E (Auth → Booking → Payment → Proof → Delivery)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const customerId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678901');
  const agentId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678903');
  const opsId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678905');

  const customerUser = {
    _id: customerId,
    phone: '+919718312383',
    name: 'Rahul Sharma',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
  };

  const agentUser = {
    _id: agentId,
    phone: '+919876543203',
    name: 'Valet Agent',
    role: OrderActorRole.AGENT,
    isActive: true,
  };

  const opsUser = {
    _id: opsId,
    phone: '+919876543205',
    name: 'Atelier Ops',
    role: OrderActorRole.OPERATIONS,
    isActive: true,
  };

  let customerToken: string;
  let agentToken: string;
  let opsToken: string;

  // Lifecycle order state
  let currentOrderStatus = OrderStatus.CONFIRMED;

  beforeAll(async () => {
    const mockAuthService = {
      requestOtp: jest.fn().mockResolvedValue({
        success: true,
        message: 'OTP sent successfully',
        expiresInSeconds: 300,
      }),
      verifyOtp: jest.fn().mockImplementation((phone, code) => {
        if (code === '123456') {
          return Promise.resolve({
            accessToken: 'mock_customer_jwt_token',
            refreshToken: 'mock_refresh_token',
            user: customerUser,
          });
        }
        throw { status: HttpStatus.UNAUTHORIZED, message: 'Invalid OTP' };
      }),
    };

    const mockBookingsService = {
      calculateQuote: jest.fn().mockResolvedValue({
        subtotalMinor: 45000,
        discountMinor: 5000,
        deliveryFeeMinor: 0,
        taxMinor: 7200,
        totalAmountMinor: 47200,
        currency: 'INR',
        itemSnapshots: [
          {
            serviceName: 'Dry Cleaning',
            itemType: '2-Piece Suit',
            quantity: 1,
            unitPriceMinor: 45000,
            totalPriceMinor: 45000,
          },
        ],
      }),
      createBooking: jest.fn().mockResolvedValue({
        bookingId: 'BK_6724fa10b91e',
        orderId: 'TC402738',
        status: 'PAYMENT_PENDING',
        totalAmountMinor: 47200,
        currency: 'INR',
        scheduledDate: '2026-11-10',
        scheduledSlot: '09:00 - 12:00',
      }),
    };

    const mockPaymentsService = {
      createPaymentIntent: jest.fn().mockResolvedValue({
        paymentId: 'pay_6724fa10b91e',
        orderId: 'TC402738',
        gatewayOrderId: 'order_rzp_402738',
        amountMinor: 47200,
        currency: 'INR',
        keyId: 'rzp_test_key',
      }),
      processWebhook: jest.fn().mockImplementation(() => {
        currentOrderStatus = OrderStatus.CONFIRMED;
        return Promise.resolve({
          success: true,
          event: 'payment.captured',
          orderId: 'TC402738',
          status: 'PAID',
        });
      }),
    };

    const mockAgentTasksService = {
      submitProof: jest.fn().mockImplementation((taskId, agent, files) => {
        if (!agent) {
          throw new BadRequestException('Agent required');
        }
        if (!files || files.length === 0) {
          throw new BadRequestException('MANDATORY_PROOF_PHOTO');
        }
        if (taskId.includes('PICKUP')) {
          currentOrderStatus = OrderStatus.PICKED_UP;
        } else {
          currentOrderStatus = OrderStatus.DELIVERED;
        }
        return Promise.resolve({
          success: true,
          taskId,
          orderId: 'TC402738',
          status: currentOrderStatus,
          proofId: 'proof_' + taskId,
          photoKeys: ['proofs/photo_1.jpg'],
        });
      }),
    };

    const mockOrdersService = {
      getCustomerOrderById: jest.fn().mockImplementation((userId, orderId) =>
        Promise.resolve({
          orderId,
          userId,
          status: currentOrderStatus,
          totalAmountMinor: 47200,
        }),
      ),
      getCustomerOrderProofs: jest.fn().mockImplementation(() =>
        Promise.resolve([
          {
            proofId: 'prf_del_402738',
            type: 'DELIVERY',
            orderId: 'TC402738',
            photoUrls: ['https://s3.atelier.com/proofs/delivery_doorstep.jpg?signed=true'],
            capturedAt: new Date(),
            handoverMethod: 'HANDED_TO_CUSTOMER',
          },
        ]),
      ),
      transitionOrderStatus: jest.fn().mockImplementation((id, targetStatus) => {
        currentOrderStatus = targetStatus;
        return Promise.resolve({
          orderId: 'TC402738',
          status: currentOrderStatus,
        });
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [() => ({ jwt: { secret: 'atelier_full_journey_secret' } })],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'atelier_full_journey_secret',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [
        AuthController,
        BookingsController,
        PaymentsController,
        AgentTasksController,
        AdminOrdersController,
        OrdersController,
      ],
      providers: [
        JwtStrategy,
        RolesGuard,
        { provide: AuthService, useValue: mockAuthService },
        { provide: BookingsService, useValue: mockBookingsService },
        { provide: PaymentsService, useValue: mockPaymentsService },
        { provide: AgentTasksService, useValue: mockAgentTasksService },
        { provide: OrdersService, useValue: mockOrdersService },
        {
          provide: getModelToken(User.name),
          useValue: {
            findById: jest.fn().mockImplementation((id) => {
              const str = id.toString();
              if (str === customerId.toString())
                return { exec: jest.fn().mockResolvedValue(customerUser) };
              if (str === agentId.toString())
                return { exec: jest.fn().mockResolvedValue(agentUser) };
              if (str === opsId.toString()) return { exec: jest.fn().mockResolvedValue(opsUser) };
              return { exec: jest.fn().mockResolvedValue(null) };
            }),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    customerToken = jwtService.sign({ sub: customerId.toString(), role: OrderActorRole.CUSTOMER });
    agentToken = jwtService.sign({ sub: agentId.toString(), role: OrderActorRole.AGENT });
    opsToken = jwtService.sign({ sub: opsId.toString(), role: OrderActorRole.OPERATIONS });
  });

  afterAll(async () => {
    await app.close();
  });

  it('Step 1: Customer requests and verifies Phone OTP to authenticate', async () => {
    // 1a: Request OTP
    const otpRes = await request(app.getHttpServer())
      .post('/auth/otp/request')
      .send({ phone: '+919718312383' })
      .expect(HttpStatus.OK);

    expect(otpRes.body.success).toBe(true);

    // 1b: Verify OTP
    const verifyRes = await request(app.getHttpServer())
      .post('/auth/otp/verify')
      .send({ phone: '+919718312383', code: '123456' })
      .expect(HttpStatus.OK);

    expect(verifyRes.body.accessToken).toBeDefined();
    expect(verifyRes.body.user.phone).toBe('+919718312383');
  });

  it('Step 2: Customer requests pricing quotation for 2-Piece Suit Dry Cleaning', async () => {
    const quoteRes = await request(app.getHttpServer())
      .post('/bookings/quote')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        items: [{ serviceId: 'srv_dc_1', itemType: '2-Piece Suit', quantity: 1 }],
        couponCode: 'ATELIERWELCOME',
      })
      .expect(HttpStatus.OK);

    expect(quoteRes.body.totalAmountMinor).toBe(47200);
    expect(quoteRes.body.currency).toBe('INR');
  });

  it('Step 3: Customer creates booking and creates Order draft (PAYMENT_PENDING)', async () => {
    const bookingRes = await request(app.getHttpServer())
      .post('/bookings')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        addressId: '66fa3b5b1a2c3d4e5f678911',
        slotId: '66fa3b5b1a2c3d4e5f678922',
        items: [{ serviceId: 'srv_dc_1', itemType: '2-Piece Suit', quantity: 1 }],
      })
      .expect(HttpStatus.CREATED);

    expect(bookingRes.body.orderId).toBe('TC402738');
    expect(bookingRes.body.status).toBe('PAYMENT_PENDING');
  });

  it('Step 4: Payment gateway captures payment webhook, transitioning order to CONFIRMED', async () => {
    const webhookRes = await request(app.getHttpServer())
      .post('/payments/webhook')
      .set('x-razorpay-signature', 'valid_hmac_test_signature')
      .send({
        event: 'payment.captured',
        payload: {
          payment: { entity: { id: 'pay_123', order_id: 'order_rzp_402738' } },
        },
      })
      .expect(HttpStatus.OK);

    expect(webhookRes.body.status).toBe('PAID');
    expect(currentOrderStatus).toBe(OrderStatus.CONFIRMED);
  });

  it('Step 5: Agent performs doorstep pickup and uploads photo proof, moving order to PICKED_UP', async () => {
    const proofRes = await request(app.getHttpServer())
      .post('/agent/tasks/TSK_PICKUP_402738/proof')
      .set('Authorization', `Bearer ${agentToken}`)
      .attach('photos', Buffer.from('pickup doorstep photo bytes'), 'pickup.jpg')
      .field('handoverMethod', 'HANDED_TO_CUSTOMER')
      .expect(HttpStatus.CREATED);

    expect(proofRes.body.status).toBe(OrderStatus.PICKED_UP);
    expect(currentOrderStatus).toBe(OrderStatus.PICKED_UP);
  });

  it('Step 6: Operations transitions order through facility cleaning lifecycle to OUT_FOR_DELIVERY', async () => {
    const statusRes = await request(app.getHttpServer())
      .patch('/admin/orders/TC402738/status')
      .set('Authorization', `Bearer ${opsToken}`)
      .send({ status: OrderStatus.OUT_FOR_DELIVERY, reason: 'Inspection passed, valets loaded' })
      .expect(HttpStatus.OK);

    expect(statusRes.body.status).toBe(OrderStatus.OUT_FOR_DELIVERY);
    expect(currentOrderStatus).toBe(OrderStatus.OUT_FOR_DELIVERY);
  });

  it('Step 7: Agent performs doorstep delivery and uploads photo proof, transitioning order to DELIVERED', async () => {
    const deliveryProofRes = await request(app.getHttpServer())
      .post('/agent/tasks/TSK_DELIVERY_402738/proof')
      .set('Authorization', `Bearer ${agentToken}`)
      .attach('photos', Buffer.from('delivery doorstep photo bytes'), 'delivery.jpg')
      .field('handoverMethod', 'LEFT_AT_DOOR')
      .expect(HttpStatus.CREATED);

    expect(deliveryProofRes.body.status).toBe(OrderStatus.DELIVERED);
    expect(currentOrderStatus).toBe(OrderStatus.DELIVERED);
  });

  it('Step 8: Customer inspects delivered order and views signed photo proof in mobile app', async () => {
    const proofsRes = await request(app.getHttpServer())
      .get('/orders/TC402738/proofs')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(HttpStatus.OK);

    expect(proofsRes.body.length).toBeGreaterThan(0);
    expect(proofsRes.body[0].type).toBe('DELIVERY');
    expect(proofsRes.body[0].photoUrls[0]).toContain('signed=true');
  });
});
