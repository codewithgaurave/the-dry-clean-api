import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BookingsController } from '../src/bookings/bookings.controller';
import { BookingsService } from '../src/bookings/bookings.service';
import { SlotsService } from '../src/slots/slots.service';
import { CouponsService } from '../src/coupons/coupons.service';
import { Booking } from '../src/database/schemas/booking.schema';
import { Order } from '../src/database/schemas/order.schema';
import { OrderStatusEvent } from '../src/database/schemas/order-status-event.schema';
import { DeliveryTask } from '../src/database/schemas/delivery-task.schema';
import { Address } from '../src/database/schemas/address.schema';
import { Service, ServicePrice } from '../src/database/schemas/service.schema';
import { IdempotencyRecord } from '../src/database/schemas/idempotency-record.schema';
import { PickupSlot } from '../src/database/schemas/pickup-slot.schema';
import { Coupon } from '../src/database/schemas/coupon.schema';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { OrderStatus } from '../src/orders/order-status.enum';

describe('BookingsController (e2e)', () => {
  let app: INestApplication;

  const validAddressId = new Types.ObjectId().toString();
  const validSlotId = new Types.ObjectId().toString();
  const validServiceId = new Types.ObjectId().toString();

  const mockAddress = {
    _id: new Types.ObjectId(validAddressId),
    label: 'Home',
    street: 'Shop No. G-246, 40 Foota Road',
    apartment: 'G-246',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110044',
    geo: { type: 'Point', coordinates: [77.3015, 28.5123] },
  };

  const mockSlot = {
    _id: new Types.ObjectId(validSlotId),
    startTime: '09:00',
    endTime: '12:00',
    capacity: 10,
    bookedCount: 2,
    cutoffHours: 2,
    isActive: true,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  const mockService = {
    _id: new Types.ObjectId(validServiceId),
    name: 'Dry Cleaning',
    slug: 'dry-cleaning',
    category: 'DRY_CLEAN',
    active: true,
  };

  const mockPrice = {
    _id: new Types.ObjectId(),
    serviceId: new Types.ObjectId(validServiceId),
    itemType: 'Men Two-Piece Suit',
    amountMinor: 35000,
    active: true,
  };

  // In-memory state tracking to verify idempotency and count
  const inMemoryOrders: any[] = [];
  const inMemoryBookings: any[] = [];
  const inMemoryIdempotency: Map<string, any> = new Map();

  const baseBookingPayload = {
    pickupAddressId: validAddressId,
    pickupSlotId: validSlotId,
    scheduledDate: '2026-11-05',
    scheduledTimeSlot: '09:00 - 12:00',
    paymentMethod: 'UPI',
    items: [
      {
        serviceId: validServiceId,
        serviceName: 'Dry Cleaning',
        itemType: 'Men Two-Piece Suit',
        quantity: 2,
        unitPriceMinor: 100, // Bogus rate, will be re-verified to 35000
      },
    ],
  };

  beforeAll(async () => {
    const bookingModel = {
      create: jest.fn().mockImplementation((data) => {
        const doc = { _id: new Types.ObjectId(), ...data };
        inMemoryBookings.push(doc);
        return Promise.resolve(doc);
      }),
      findById: jest.fn().mockImplementation((id: string) => {
        const found = inMemoryBookings.find((b) => b._id.toString() === id);
        return Promise.resolve(found || null);
      }),
    };

    const orderModel = {
      create: jest.fn().mockImplementation((data) => {
        const doc = { _id: new Types.ObjectId(), ...data, createdAt: new Date() };
        inMemoryOrders.push(doc);
        return Promise.resolve(doc);
      }),
      findOne: jest.fn().mockImplementation((query: any) => {
        const found = inMemoryOrders.find((o) => o.orderId === query.orderId);
        return Promise.resolve(found || null);
      }),
    };

    const orderStatusEventModel = {
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    };

    const deliveryTaskModel = {
      create: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        taskId: 'TSK_P_402736',
      }),
    };

    const addressModel = {
      findById: jest.fn().mockResolvedValue(mockAddress),
    };

    const serviceModel = {
      findById: jest.fn().mockResolvedValue(mockService),
    };

    const servicePriceModel = {
      findOne: jest.fn().mockResolvedValue(mockPrice),
    };

    const idempotencyRecordModel = {
      findOne: jest.fn().mockImplementation((query: any) => {
        const record = inMemoryIdempotency.get(query.key);
        return Promise.resolve(record || null);
      }),
      create: jest.fn().mockImplementation((data) => {
        inMemoryIdempotency.set(data.key, data);
        return Promise.resolve(data);
      }),
    };

    const pickupSlotModel = {
      findById: jest.fn().mockResolvedValue(mockSlot),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };

    const couponModel = {
      findOne: jest.fn().mockResolvedValue(null),
      countDocuments: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({}),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        BookingsService,
        SlotsService,
        CouponsService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(OrderStatusEvent.name), useValue: orderStatusEventModel },
        { provide: getModelToken(DeliveryTask.name), useValue: deliveryTaskModel },
        { provide: getModelToken(Address.name), useValue: addressModel },
        { provide: getModelToken(Service.name), useValue: serviceModel },
        { provide: getModelToken(ServicePrice.name), useValue: servicePriceModel },
        { provide: getModelToken(IdempotencyRecord.name), useValue: idempotencyRecordModel },
        { provide: getModelToken(PickupSlot.name), useValue: pickupSlotModel },
        { provide: getModelToken(Coupon.name), useValue: couponModel },
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

  describe('POST /v1/bookings - Idempotent Creation & Deduplication', () => {
    const idempotencyKey = 'idemp-key-e2e-001';
    let firstOrderId: string;
    let firstBookingId: string;

    it('should create a new booking and order on initial submission', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(baseBookingPayload)
        .expect(HttpStatus.CREATED);

      expect(response.body).toBeDefined();
      expect(response.body.orderId).toMatch(/^TC\d{6}$/);
      expect(response.body.status).toBe(OrderStatus.PAYMENT_PENDING);
      expect(response.body.isIdempotentReplay).toBe(false);

      // Verify server re-verified rates: 2 * 35000 = 70000 + 12600 GST = 82600
      expect(response.body.pricing.subtotalMinor).toBe(70000);
      expect(response.body.pricing.gstMinor).toBe(12600);
      expect(response.body.pricing.totalAmountMinor).toBe(82600);
      expect(response.body.deliveryTaskId).toBeDefined();

      firstOrderId = response.body.orderId;
      firstBookingId = response.body.bookingId;

      expect(inMemoryOrders.length).toBe(1);
      expect(inMemoryBookings.length).toBe(1);
    });

    it('should replay identical snapshot without creating duplicate order on repeated submission', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(baseBookingPayload)
        .expect(HttpStatus.CREATED);

      expect(response.body).toBeDefined();
      expect(response.body.orderId).toBe(firstOrderId);
      expect(response.body.bookingId).toBe(firstBookingId);
      expect(response.body.isIdempotentReplay).toBe(true);

      // Crucial assertion: no new order or booking document was created
      expect(inMemoryOrders.length).toBe(1);
      expect(inMemoryBookings.length).toBe(1);
    });

    it('should reject with 409 Conflict if same Idempotency-Key is reused with different payload', async () => {
      const alteredPayload = {
        ...baseBookingPayload,
        scheduledDate: '2026-11-06', // Different date!
      };

      const response = await request(app.getHttpServer())
        .post('/v1/bookings')
        .set('Idempotency-Key', idempotencyKey)
        .send(alteredPayload)
        .expect(HttpStatus.CONFLICT);

      expect(response.body.statusCode).toBe(409);
      expect(response.body.message).toContain('Idempotency-Key has already been used');
    });

    it('should reject with 400 Bad Request if Idempotency-Key header is missing', async () => {
      const response = await request(app.getHttpServer())
        .post('/v1/bookings')
        .send(baseBookingPayload)
        .expect(HttpStatus.BAD_REQUEST);

      expect(response.body.statusCode).toBe(400);
      expect(response.body.message).toContain('Idempotency-Key header is required');
    });
  });

  describe('GET /v1/bookings/:id & GET /v1/bookings/orders/:orderId', () => {
    it('should retrieve existing order by tracking ID', async () => {
      const existingOrder = inMemoryOrders[0];
      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/orders/${existingOrder.orderId}`)
        .expect(HttpStatus.OK);

      expect(response.body.orderId).toBe(existingOrder.orderId);
      expect(response.body.status).toBe(OrderStatus.PAYMENT_PENDING);
    });

    it('should return 404 for unknown order tracking ID', async () => {
      await request(app.getHttpServer())
        .get('/v1/bookings/orders/TC999999')
        .expect(HttpStatus.NOT_FOUND);
    });

    it('should retrieve existing booking by ID', async () => {
      const existingBooking = inMemoryBookings[0];
      const response = await request(app.getHttpServer())
        .get(`/v1/bookings/${existingBooking._id.toString()}`)
        .expect(HttpStatus.OK);

      expect(response.body._id).toBe(existingBooking._id.toString());
      expect(response.body.scheduledDate).toBe('2026-11-05');
    });

    it('should return 404 for non-existent booking ID', async () => {
      const unknownId = new Types.ObjectId().toString();
      await request(app.getHttpServer())
        .get(`/v1/bookings/${unknownId}`)
        .expect(HttpStatus.NOT_FOUND);
    });
  });
});
