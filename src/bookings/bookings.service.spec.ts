import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import * as crypto from 'crypto';
import { BookingsService } from './bookings.service';
import { Booking } from '../database/schemas/booking.schema';
import { Order } from '../database/schemas/order.schema';
import { OrderStatusEvent } from '../database/schemas/order-status-event.schema';
import { DeliveryTask } from '../database/schemas/delivery-task.schema';
import { Address } from '../database/schemas/address.schema';
import { Service, ServicePrice } from '../database/schemas/service.schema';
import { IdempotencyRecord } from '../database/schemas/idempotency-record.schema';
import { SlotsService } from '../slots/slots.service';
import { CouponsService } from '../coupons/coupons.service';
import { OrderStatus } from '../orders/order-status.enum';
import { CreateBookingDto } from './dto/create-booking.dto';

describe('BookingsService', () => {
  let service: BookingsService;
  let bookingModel: any;
  let orderModel: any;
  let orderStatusEventModel: any;
  let deliveryTaskModel: any;
  let addressModel: any;
  let serviceModel: any;
  let servicePriceModel: any;
  let idempotencyRecordModel: any;
  let slotsService: any;
  let couponsService: any;

  const validAddressId = new Types.ObjectId().toString();
  const validSlotId = new Types.ObjectId().toString();
  const validServiceId = new Types.ObjectId().toString();
  const validUserId = new Types.ObjectId().toString();

  const mockAddressDoc = {
    _id: new Types.ObjectId(validAddressId),
    userId: new Types.ObjectId(validUserId),
    label: 'Home',
    street: 'Shop No. G-246, 40 Foota Road',
    apartment: 'Apt 4B',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110044',
    geo: { type: 'Point', coordinates: [77.3015, 28.5123] },
  };

  const mockSlotDoc = {
    _id: new Types.ObjectId(validSlotId),
    startTime: '09:00',
    endTime: '12:00',
    capacity: 10,
    bookedCount: 2,
    cutoffHours: 2,
    isActive: true,
  };

  const mockServiceDoc = {
    _id: new Types.ObjectId(validServiceId),
    name: 'Dry Cleaning',
    slug: 'dry-cleaning',
    category: 'DRY_CLEAN',
    active: true,
  };

  const mockPriceDoc = {
    _id: new Types.ObjectId(),
    serviceId: new Types.ObjectId(validServiceId),
    itemType: 'Men Two-Piece Suit',
    amountMinor: 35000, // ₹350.00
    active: true,
  };

  const sampleBookingDto: CreateBookingDto = {
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
        unitPriceMinor: 100, // Client sent bogus rate; backend must re-verify!
      },
    ],
  };

  beforeEach(async () => {
    bookingModel = {
      create: jest.fn().mockImplementation((data) => ({
        _id: new Types.ObjectId(),
        ...data,
      })),
      findById: jest.fn(),
    };

    orderModel = {
      create: jest.fn().mockImplementation((data) => ({
        _id: new Types.ObjectId(),
        ...data,
        createdAt: new Date(),
      })),
      findOne: jest.fn(),
    };

    orderStatusEventModel = {
      create: jest.fn().mockImplementation((data) => ({
        _id: new Types.ObjectId(),
        ...data,
      })),
    };

    deliveryTaskModel = {
      create: jest.fn().mockImplementation((data) => ({
        _id: new Types.ObjectId(),
        ...data,
      })),
    };

    addressModel = {
      findById: jest.fn().mockResolvedValue(mockAddressDoc),
    };

    serviceModel = {
      findById: jest.fn().mockResolvedValue(mockServiceDoc),
    };

    servicePriceModel = {
      findOne: jest.fn().mockResolvedValue(mockPriceDoc),
    };

    idempotencyRecordModel = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((data) => ({
        _id: new Types.ObjectId(),
        ...data,
      })),
    };

    slotsService = {
      getSlotById: jest.fn().mockResolvedValue(mockSlotDoc),
      validateDate: jest.fn(),
      formatDate: jest.fn().mockReturnValue('2026-11-01'),
      hasCutoffPassed: jest.fn().mockReturnValue(false),
      reserveSlot: jest.fn().mockResolvedValue(true),
    };

    couponsService = {
      validateCoupon: jest.fn().mockResolvedValue({
        code: 'WELCOME10',
        discountMinor: 7000,
        subtotalMinor: 70000,
      }),
      recordCouponUsage: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: getModelToken(Booking.name), useValue: bookingModel },
        { provide: getModelToken(Order.name), useValue: orderModel },
        { provide: getModelToken(OrderStatusEvent.name), useValue: orderStatusEventModel },
        { provide: getModelToken(DeliveryTask.name), useValue: deliveryTaskModel },
        { provide: getModelToken(Address.name), useValue: addressModel },
        { provide: getModelToken(Service.name), useValue: serviceModel },
        { provide: getModelToken(ServicePrice.name), useValue: servicePriceModel },
        { provide: getModelToken(IdempotencyRecord.name), useValue: idempotencyRecordModel },
        { provide: SlotsService, useValue: slotsService },
        { provide: CouponsService, useValue: couponsService },
      ],
    }).compile();

    service = module.get<BookingsService>(BookingsService);
  });

  describe('createBooking - Core Verification & Creation', () => {
    it('should create booking, order, task, and status event with verified prices', async () => {
      const idempotencyKey = 'req-key-001';
      const result = await service.createBooking(sampleBookingDto, idempotencyKey);

      expect(result).toBeDefined();
      expect(result.orderId).toMatch(/^TC\d{6}$/);
      expect(result.status).toBe(OrderStatus.PAYMENT_PENDING);
      expect(result.paymentStatus).toBe('PENDING');
      expect(result.isIdempotentReplay).toBe(false);

      // Verify server authoritatively calculated prices (2 * 35000 = 70000)
      expect(result.pricing.subtotalMinor).toBe(70000);
      expect(result.pricing.deliveryFeeMinor).toBe(0); // Subtotal >= ₹500
      expect(result.pricing.gstMinor).toBe(Math.round(70000 * 0.18)); // 12600
      expect(result.pricing.totalAmountMinor).toBe(70000 + 12600); // 82600

      // Verify slot capacity was decremented / reserved
      expect(slotsService.reserveSlot).toHaveBeenCalledWith(validSlotId);

      // Verify order creation was called with canonical orderId
      expect(orderModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: result.orderId,
          status: OrderStatus.PAYMENT_PENDING,
          paymentMethod: 'UPI',
        }),
      );

      // Verify initial OrderStatusEvent was recorded
      expect(orderStatusEventModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: result.orderId,
          previousStatus: OrderStatus.DRAFT,
          status: OrderStatus.PAYMENT_PENDING,
        }),
      );

      // Verify delivery task was created for pickup
      expect(deliveryTaskModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: result.orderId,
          taskType: 'PICKUP',
          status: 'ASSIGNED',
        }),
      );

      // Verify IdempotencyRecord was created with response snapshot
      expect(idempotencyRecordModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scope: 'BOOKING',
          key: idempotencyKey,
          statusCode: 201,
        }),
      );
    });

    it('should set status to CONFIRMED and paymentStatus to PAID when paymentMethod is CASH', async () => {
      const cashDto: CreateBookingDto = {
        ...sampleBookingDto,
        paymentMethod: 'CASH',
      };

      const result = await service.createBooking(cashDto, 'cash-key-001');

      expect(result.status).toBe(OrderStatus.CONFIRMED);
      expect(result.paymentStatus).toBe('PAID');
      expect(orderModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: OrderStatus.CONFIRMED,
          paymentStatus: 'PAID',
        }),
      );
    });

    it('should apply coupon discount and call recordCouponUsage', async () => {
      const couponDto: CreateBookingDto = {
        ...sampleBookingDto,
        couponCode: 'WELCOME10',
      };

      const result = await service.createBooking(couponDto, 'coupon-key-001');

      expect(couponsService.validateCoupon).toHaveBeenCalled();
      expect(couponsService.recordCouponUsage).toHaveBeenCalledWith('WELCOME10');
      expect(result.pricing.discountMinor).toBe(7000);
      // Taxable = 70000 - 7000 = 63000, GST = 63000 * 0.18 = 11340, Total = 63000 + 11340 = 74340
      expect(result.pricing.totalAmountMinor).toBe(63000 + 11340);
    });
  });

  describe('createBooking - Idempotency Guarantees', () => {
    it('should return cached snapshot without recreating order on duplicate request with same key', async () => {
      const idempotencyKey = 'replay-key-001';
      const requestHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(sampleBookingDto))
        .digest('hex');

      const cachedSnapshot = {
        bookingId: '66fa3b5b1a2c3d4e5f678903',
        orderId: 'TC402736',
        status: OrderStatus.PAYMENT_PENDING,
        paymentStatus: 'PENDING',
        paymentMethod: 'UPI',
        scheduledDate: '2026-11-05',
        scheduledTimeSlot: '09:00 - 12:00',
        pricing: {
          subtotalMinor: 70000,
          discountMinor: 0,
          deliveryFeeMinor: 0,
          gstMinor: 12600,
          totalAmountMinor: 82600,
          totalAmountFormatted: '₹826.00',
          currency: 'INR',
        },
        deliveryTaskId: 'TSK_P_402736',
        isIdempotentReplay: false,
        createdAt: new Date(),
      };

      idempotencyRecordModel.findOne.mockResolvedValue({
        scope: 'BOOKING',
        key: idempotencyKey,
        requestHash,
        responseSnapshot: cachedSnapshot,
      });

      const result = await service.createBooking(sampleBookingDto, idempotencyKey);

      expect(result.orderId).toBe('TC402736');
      expect(result.isIdempotentReplay).toBe(true);

      // Crucial: no DB writes should occur on replay
      expect(orderModel.create).not.toHaveBeenCalled();
      expect(bookingModel.create).not.toHaveBeenCalled();
      expect(deliveryTaskModel.create).not.toHaveBeenCalled();
      expect(orderStatusEventModel.create).not.toHaveBeenCalled();
      expect(slotsService.reserveSlot).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if same idempotency key is used with different payload', async () => {
      const idempotencyKey = 'conflict-key-001';

      idempotencyRecordModel.findOne.mockResolvedValue({
        scope: 'BOOKING',
        key: idempotencyKey,
        requestHash: 'different-sha256-hash',
        responseSnapshot: {},
      });

      await expect(service.createBooking(sampleBookingDto, idempotencyKey)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should throw BadRequestException if Idempotency-Key is missing or empty', async () => {
      await expect(service.createBooking(sampleBookingDto, '')).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.createBooking(sampleBookingDto, '   ')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('createBooking - Validations & Rejections', () => {
    it('should throw BadRequestException if address does not exist', async () => {
      addressModel.findById.mockResolvedValue(null);

      await expect(service.createBooking(sampleBookingDto, 'key-bad-addr')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if slot is inactive or not found', async () => {
      slotsService.getSlotById.mockResolvedValue(null);

      await expect(service.createBooking(sampleBookingDto, 'key-bad-slot')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if slot capacity is full', async () => {
      slotsService.getSlotById.mockResolvedValue({
        ...mockSlotDoc,
        capacity: 5,
        bookedCount: 5,
      });

      await expect(service.createBooking(sampleBookingDto, 'key-full-slot')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if cutoff time has passed for today', async () => {
      const today = new Date('2026-11-01T10:00:00Z');
      slotsService.formatDate.mockReturnValue('2026-11-01');
      slotsService.hasCutoffPassed.mockReturnValue(true);

      const todayDto = { ...sampleBookingDto, scheduledDate: '2026-11-01' };

      await expect(
        service.createBooking(todayDto, 'key-cutoff-slot', undefined, today),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if service is inactive or not found', async () => {
      serviceModel.findById.mockResolvedValue(null);

      await expect(service.createBooking(sampleBookingDto, 'key-bad-svc')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if item rate is not configured in database', async () => {
      servicePriceModel.findOne.mockResolvedValue(null);
      const dtoWithZeroPrice: CreateBookingDto = {
        ...sampleBookingDto,
        items: [
          {
            serviceId: validServiceId,
            serviceName: 'Dry Cleaning',
            itemType: 'Unknown Item',
            quantity: 1,
            unitPriceMinor: 0,
          },
        ],
      };

      await expect(
        service.createBooking(dtoWithZeroPrice, 'key-unconfigured-price'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Lookup Methods', () => {
    it('should retrieve order by orderId tracking number', async () => {
      const mockOrder = { orderId: 'TC402736', status: OrderStatus.CONFIRMED };
      orderModel.findOne.mockResolvedValue(mockOrder);

      const result = await service.getOrderByOrderId('TC402736');
      expect(result).toEqual(mockOrder);
      expect(orderModel.findOne).toHaveBeenCalledWith({ orderId: 'TC402736' });
    });

    it('should retrieve booking by MongoDB ObjectId', async () => {
      const id = new Types.ObjectId().toString();
      const mockBooking = { _id: id, status: 'CONFIRMED' };
      bookingModel.findById.mockResolvedValue(mockBooking);

      const result = await service.getBookingById(id);
      expect(result).toEqual(mockBooking);
      expect(bookingModel.findById).toHaveBeenCalledWith(id);
    });

    it('should throw BadRequestException if bookingId is not a valid ObjectId', async () => {
      await expect(service.getBookingById('invalid-id')).rejects.toThrow(BadRequestException);
    });
  });
});
