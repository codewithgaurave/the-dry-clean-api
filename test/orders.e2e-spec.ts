import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';
import { Order } from '../src/database/schemas/order.schema';
import { OrderStatusEvent } from '../src/database/schemas/order-status-event.schema';
import { DeliveryTask } from '../src/database/schemas/delivery-task.schema';
import { User } from '../src/database/schemas/user.schema';
import { OrderStatus, OrderActorRole } from '../src/orders/order-status.enum';
import { OrderTransitionService } from '../src/orders/order-transition.service';
import { JwtStrategy } from '../src/auth/jwt.strategy';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('OrdersController (e2e)', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  const userAId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678901');
  const userBId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678902');

  const userA = {
    _id: userAId,
    phone: '+919876543210',
    name: 'Customer A',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
  };

  const userB = {
    _id: userBId,
    phone: '+919876543211',
    name: 'Customer B',
    role: OrderActorRole.CUSTOMER,
    isActive: true,
  };

  let tokenUserA: string;
  let tokenUserB: string;

  const orderA1Id = new Types.ObjectId('66fa3b5b1a2c3d4e5f678910');
  const orderA2Id = new Types.ObjectId('66fa3b5b1a2c3d4e5f678911');
  const orderB1Id = new Types.ObjectId('66fa3b5b1a2c3d4e5f678920');

  const orderA1 = {
    _id: orderA1Id,
    orderId: 'TC402736',
    userId: userAId,
    status: OrderStatus.CONFIRMED,
    paymentStatus: 'PAID',
    paymentMethod: 'UPI',
    items: [
      {
        serviceName: 'Dry Clean',
        itemType: 'Suit (2-Piece)',
        quantity: 1,
        unitPriceMinor: 35000,
        totalPriceMinor: 35000,
      },
    ],
    pricingSnapshot: {
      subtotalMinor: 35000,
      discountMinor: 0,
      deliveryFeeMinor: 0,
      totalAmountMinor: 35000,
      currency: 'INR',
    },
    addressSnapshot: {
      label: 'Home',
      street: '42 Atelier Luxury Boulevard, Sector 18',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122001',
    },
    createdAt: new Date('2026-11-01T10:00:00Z'),
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  const orderA2 = {
    _id: orderA2Id,
    orderId: 'TC402737',
    userId: userAId,
    status: OrderStatus.DELIVERED,
    paymentStatus: 'PAID',
    paymentMethod: 'UPI',
    items: [
      {
        serviceName: 'Shoe Care',
        itemType: 'Leather Loafers',
        quantity: 1,
        unitPriceMinor: 15000,
        totalPriceMinor: 15000,
      },
    ],
    pricingSnapshot: {
      subtotalMinor: 15000,
      discountMinor: 0,
      deliveryFeeMinor: 5000,
      totalAmountMinor: 20000,
      currency: 'INR',
    },
    addressSnapshot: {
      label: 'Home',
      street: '42 Atelier Luxury Boulevard, Sector 18',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122001',
    },
    createdAt: new Date('2026-10-25T14:00:00Z'),
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  const orderA3Id = new Types.ObjectId('66fa3b5b1a2c3d4e5f678912');
  const orderA3 = {
    _id: orderA3Id,
    orderId: 'TC402738',
    userId: userAId,
    status: OrderStatus.CLEANING_IN_PROGRESS,
    paymentStatus: 'PAID',
    paymentMethod: 'UPI',
    items: [],
    pricingSnapshot: {
      subtotalMinor: 40000,
      discountMinor: 0,
      deliveryFeeMinor: 0,
      totalAmountMinor: 40000,
      currency: 'INR',
    },
    addressSnapshot: {
      label: 'Home',
      street: '42 Atelier Luxury Boulevard, Sector 18',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122001',
    },
    createdAt: new Date('2026-11-01T08:00:00Z'),
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  const orderB1 = {
    _id: orderB1Id,
    orderId: 'TC999999',
    userId: userBId,
    status: OrderStatus.CONFIRMED,
    paymentStatus: 'PAID',
    paymentMethod: 'CARD',
    items: [
      {
        serviceName: 'Couture Restoration',
        itemType: 'Silk Evening Gown',
        quantity: 1,
        unitPriceMinor: 85000,
        totalPriceMinor: 85000,
      },
    ],
    pricingSnapshot: {
      subtotalMinor: 85000,
      discountMinor: 0,
      deliveryFeeMinor: 0,
      totalAmountMinor: 85000,
      currency: 'INR',
    },
    addressSnapshot: {
      label: 'Penthouse',
      street: '99 Ambience Island',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122002',
    },
    createdAt: new Date('2026-11-01T11:00:00Z'),
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  const allOrders = [orderA1, orderA2, orderA3, orderB1];

  const eventsA1 = [
    {
      _id: new Types.ObjectId(),
      orderId: 'TC402736',
      orderRef: orderA1Id,
      previousStatus: OrderStatus.DRAFT,
      status: OrderStatus.CONFIRMED,
      timestamp: new Date('2026-11-01T10:05:00Z'),
      updatedBy: { actorRole: OrderActorRole.SYSTEM, actorId: 'SYS_01', name: 'Order Engine' },
      createdAt: new Date('2026-11-01T10:05:00Z'),
    },
    {
      _id: new Types.ObjectId(),
      orderId: 'TC402736',
      orderRef: orderA1Id,
      previousStatus: OrderStatus.CONFIRMED,
      status: OrderStatus.PICKUP_SCHEDULED,
      timestamp: new Date('2026-11-01T10:10:00Z'),
      updatedBy: { actorRole: OrderActorRole.SYSTEM, actorId: 'SYS_01', name: 'Valet Dispatcher' },
      createdAt: new Date('2026-11-01T10:10:00Z'),
    },
  ];

  const eventsB1 = [
    {
      _id: new Types.ObjectId(),
      orderId: 'TC999999',
      orderRef: orderB1Id,
      previousStatus: OrderStatus.DRAFT,
      status: OrderStatus.CONFIRMED,
      timestamp: new Date('2026-11-01T11:05:00Z'),
      updatedBy: { actorRole: OrderActorRole.SYSTEM, actorId: 'SYS_01', name: 'Order Engine' },
      createdAt: new Date('2026-11-01T11:05:00Z'),
    },
  ];

  let orderModelMock: any;
  let orderStatusEventModelMock: any;
  let userModelMock: any;
  let deliveryTaskModelMock: any;
  let orderTransitionServiceMock: any;

  beforeAll(async () => {
    orderModelMock = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    orderStatusEventModelMock = {
      find: jest.fn(),
      create: jest.fn(),
    };

    userModelMock = {
      findById: jest.fn(),
    };

    deliveryTaskModelMock = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    orderTransitionServiceMock = {
      transitionOrderStatus: jest.fn().mockImplementation((orderId, targetStatus, context) => {
        const order = allOrders.find((o) => o.orderId === orderId);
        if (order) {
          order.status = targetStatus;
        }
        return Promise.resolve({
          order: { ...order, status: targetStatus },
          event: { status: targetStatus, note: context?.note },
        });
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [
            () => ({
              jwt: {
                secret: 'atelier_e2e_jwt_secret',
                expiresIn: '1h',
              },
            }),
          ],
        }),
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({
          secret: 'atelier_e2e_jwt_secret',
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [OrdersController],
      providers: [
        OrdersService,
        JwtStrategy,
        { provide: getModelToken(Order.name), useValue: orderModelMock },
        {
          provide: getModelToken(OrderStatusEvent.name),
          useValue: orderStatusEventModelMock,
        },
        { provide: getModelToken(DeliveryTask.name), useValue: deliveryTaskModelMock },
        { provide: OrderTransitionService, useValue: orderTransitionServiceMock },
        { provide: getModelToken(User.name), useValue: userModelMock },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());

    await app.init();

    jwtService = moduleFixture.get<JwtService>(JwtService);
    tokenUserA = jwtService.sign({
      sub: userAId.toString(),
      phone: userA.phone,
      role: userA.role,
    });
    tokenUserB = jwtService.sign({
      sub: userBId.toString(),
      phone: userB.phone,
      role: userB.role,
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();

    userModelMock.findById.mockImplementation((id: Types.ObjectId | string) => ({
      exec: jest
        .fn()
        .mockResolvedValue(
          id.toString() === userAId.toString()
            ? userA
            : id.toString() === userBId.toString()
              ? userB
              : null,
        ),
    }));

    orderModelMock.find.mockImplementation((filter: any) => {
      let filtered = allOrders.filter((o) => o.userId.toString() === filter.userId.toString());

      if (filter.status) {
        if (filter.status.$nin) {
          filtered = filtered.filter((o) => !filter.status.$nin.includes(o.status));
        } else if (filter.status.$in) {
          filtered = filtered.filter((o) => filter.status.$in.includes(o.status));
        } else if (typeof filter.status === 'string') {
          filtered = filtered.filter((o) => o.status === filter.status);
        }
      }

      return {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(filtered),
      };
    });

    orderModelMock.countDocuments.mockImplementation((filter: any) => {
      let filtered = allOrders.filter((o) => o.userId.toString() === filter.userId.toString());

      if (filter.status) {
        if (filter.status.$nin) {
          filtered = filtered.filter((o) => !filter.status.$nin.includes(o.status));
        } else if (filter.status.$in) {
          filtered = filtered.filter((o) => filter.status.$in.includes(o.status));
        } else if (typeof filter.status === 'string') {
          filtered = filtered.filter((o) => o.status === filter.status);
        }
      }

      return {
        exec: jest.fn().mockResolvedValue(filtered.length),
      };
    });

    orderModelMock.findOne.mockImplementation((filter: any) => {
      const targetUserId = filter.userId?.toString();
      const match = allOrders.find((o) => {
        if (o.userId.toString() !== targetUserId) return false;
        if (filter.orderId) return o.orderId === filter.orderId;
        if (filter.$or) {
          return filter.$or.some((item: any) => {
            if (item.orderId && item.orderId === o.orderId) return true;
            if (item._id && item._id.toString() === o._id.toString()) return true;
            return false;
          });
        }
        return false;
      });

      return {
        exec: jest.fn().mockResolvedValue(match || null),
      };
    });

    orderStatusEventModelMock.find.mockImplementation((filter: any) => {
      let events: any[] = [];
      const orderRefTarget = filter.$or?.find((i: any) => i.orderRef)?.orderRef?.toString();
      const orderIdTarget = filter.$or?.find((i: any) => i.orderId)?.orderId;

      if (orderRefTarget === orderA1Id.toString() || orderIdTarget === 'TC402736') {
        events = eventsA1;
      } else if (orderRefTarget === orderB1Id.toString() || orderIdTarget === 'TC999999') {
        events = eventsB1;
      }

      return {
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(events),
      };
    });
  });

  describe('GET /v1/orders (List Customer Orders)', () => {
    it('should reject unauthenticated request with 401', async () => {
      await request(app.getHttpServer()).get('/v1/orders').expect(HttpStatus.UNAUTHORIZED);
    });

    it('should list only Customer A orders when authenticated as Customer A', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(response.body).toHaveProperty('orders');
      expect(response.body).toHaveProperty('total', 3);
      expect(response.body).toHaveProperty('page', 1);
      expect(response.body).toHaveProperty('limit', 20);
      expect(response.body).toHaveProperty('totalPages', 1);

      // Verify all returned orders belong to Customer A
      const returnedOrderIds = response.body.orders.map((o: any) => o.orderId);
      expect(returnedOrderIds).toContain('TC402736');
      expect(returnedOrderIds).toContain('TC402737');
      expect(returnedOrderIds).toContain('TC402738');
      expect(returnedOrderIds).not.toContain('TC999999');
    });

    it('should filter active orders when status=active is requested', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders?status=active')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(response.body.orders).toHaveLength(2);
      const activeIds = response.body.orders.map((o: any) => o.orderId);
      expect(activeIds).toContain('TC402736');
      expect(activeIds).toContain('TC402738');
    });

    it('should filter past orders when status=past is requested', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders?status=past')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(response.body.orders).toHaveLength(1);
      expect(response.body.orders[0].orderId).toBe('TC402737');
      expect(response.body.orders[0].status).toBe(OrderStatus.DELIVERED);
    });

    it('should list only Customer B orders when authenticated as Customer B', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(HttpStatus.OK);

      expect(response.body.orders).toHaveLength(1);
      expect(response.body.orders[0].orderId).toBe('TC999999');
    });
  });

  describe('GET /v1/orders/:id (Customer Order Details & Strict Tenancy)', () => {
    it('should reject unauthenticated request with 401', async () => {
      await request(app.getHttpServer()).get('/v1/orders/TC402736').expect(HttpStatus.UNAUTHORIZED);
    });

    it('should allow Customer A to fetch their own order by canonical orderId', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders/TC402736')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(response.body.orderId).toBe('TC402736');
      expect(response.body.status).toBe(OrderStatus.CONFIRMED);
      expect(response.body.pricingSnapshot.totalAmountMinor).toBe(35000);
      expect(response.body.addressSnapshot.label).toBe('Home');
    });

    it('should allow Customer A to fetch their own order by MongoDB ObjectId', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/orders/${orderA1Id.toString()}`)
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(response.body.orderId).toBe('TC402736');
    });

    it('should prevent Customer A from fetching Customer B order (Strict Tenancy)', async () => {
      // Customer A tries to fetch Customer B's order TC999999
      const response = await request(app.getHttpServer())
        .get('/v1/orders/TC999999')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.message).toContain('Order not found or you are not authorized');
    });

    it('should prevent Customer B from fetching Customer A order (Strict Tenancy)', async () => {
      // Customer B tries to fetch Customer A's order TC402736
      const response = await request(app.getHttpServer())
        .get('/v1/orders/TC402736')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.message).toContain('Order not found or you are not authorized');
    });

    it('should return 404 for a completely non-existent order', async () => {
      await request(app.getHttpServer())
        .get('/v1/orders/TC_NON_EXISTENT')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.NOT_FOUND);
    });
  });

  describe('GET /v1/orders/:id/events (Status Timeline History & Strict Tenancy)', () => {
    it('should reject unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .get('/v1/orders/TC402736/events')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should return chronological status events for Customer A own order', async () => {
      const response = await request(app.getHttpServer())
        .get('/v1/orders/TC402736/events')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.OK);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body).toHaveLength(2);
      expect(response.body[0].status).toBe(OrderStatus.CONFIRMED);
      expect(response.body[1].status).toBe(OrderStatus.PICKUP_SCHEDULED);
    });

    it('should prevent Customer A from fetching Customer B order events (Strict Tenancy)', async () => {
      // Customer A tries to read event history of Customer B's order TC999999
      const response = await request(app.getHttpServer())
        .get('/v1/orders/TC999999/events')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.message).toContain('Order not found or you are not authorized');
    });

    it('should prevent Customer B from fetching Customer A order events (Strict Tenancy)', async () => {
      // Customer B tries to read event history of Customer A's order TC402736
      const response = await request(app.getHttpServer())
        .get('/v1/orders/TC402736/events')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.message).toContain('Order not found or you are not authorized');
    });
  });

  describe('POST /v1/orders/:id/cancel (Order Cancellation Business Rules - TASK-033)', () => {
    it('should reject unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .post('/v1/orders/TC402736/cancel')
        .send({ reason: 'Trip cancelled' })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should cancel an eligible order in CONFIRMED status', async () => {
      orderA1.status = OrderStatus.CONFIRMED;

      const response = await request(app.getHttpServer())
        .post('/v1/orders/TC402736/cancel')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ reason: 'Change of plans' })
        .expect(HttpStatus.OK);

      expect(response.body.status).toBe(OrderStatus.CANCELLED);
      expect(orderTransitionServiceMock.transitionOrderStatus).toHaveBeenCalledWith(
        'TC402736',
        OrderStatus.CANCELLED,
        expect.objectContaining({ note: 'Change of plans' }),
      );
      expect(deliveryTaskModelMock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'TC402736' }),
        expect.any(Object),
      );
    });

    it('should reject cancellation with 400 Bad Request if order is in CLEANING_IN_PROGRESS', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders/TC402738/cancel')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({ reason: 'Need them back' })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain(
        "Cancellation is not allowed for order TC402738 in status 'CLEANING_IN_PROGRESS'",
      );
    });

    it('should prevent Customer B from cancelling Customer A order (Strict Tenancy 404)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders/TC402736/cancel')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({ reason: 'Malicious attempt' })
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.message).toContain('Order not found or you are not authorized');
    });
  });

  describe('POST /v1/orders/:id/reschedule (Order Rescheduling Business Rules - TASK-033)', () => {
    it('should reject unauthenticated request with 401', async () => {
      await request(app.getHttpServer())
        .post('/v1/orders/TC402736/reschedule')
        .send({ date: '2026-10-31', timeSlot: '14:00 - 16:00' })
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('should reschedule pickup window for order in CONFIRMED status', async () => {
      orderA1.status = OrderStatus.CONFIRMED;

      const response = await request(app.getHttpServer())
        .post('/v1/orders/TC402736/reschedule')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          date: '2026-10-31',
          timeSlot: '14:00 - 16:00',
          reason: 'Travelling in morning',
        })
        .expect(HttpStatus.OK);

      expect(response.body.status).toBe(OrderStatus.RESCHEDULED);
      expect(response.body.currentScheduledWindow).toEqual({
        type: 'PICKUP',
        date: '2026-10-31',
        timeSlot: '14:00 - 16:00',
      });
      expect(deliveryTaskModelMock.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'TC402736' }),
        expect.objectContaining({
          $set: expect.objectContaining({
            scheduledDate: '2026-10-31',
            scheduledTimeWindow: '14:00 - 16:00',
          }),
        }),
      );
    });

    it('should reject rescheduling with 400 Bad Request if garments already in CLEANING_IN_PROGRESS', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders/TC402738/reschedule')
        .set('Authorization', `Bearer ${tokenUserA}`)
        .send({
          date: '2026-10-31',
          timeSlot: '14:00 - 16:00',
        })
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.message).toContain(
        "Rescheduling pickup is not allowed for order TC402738 in status 'CLEANING_IN_PROGRESS'",
      );
    });

    it('should prevent Customer B from rescheduling Customer A order (Strict Tenancy 404)', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/orders/TC402736/reschedule')
        .set('Authorization', `Bearer ${tokenUserB}`)
        .send({
          date: '2026-10-31',
          timeSlot: '14:00 - 16:00',
        })
        .expect(HttpStatus.NOT_FOUND);

      expect(response.body.message).toContain('Order not found or you are not authorized');
    });
  });
});
