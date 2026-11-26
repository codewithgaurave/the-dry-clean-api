import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingResponseDto } from './dto/booking-response.dto';

describe('BookingsController', () => {
  let controller: BookingsController;
  let service: BookingsService;

  const mockBookingResponse: BookingResponseDto = {
    bookingId: '66fa3b5b1a2c3d4e5f678903',
    orderId: 'TC402736',
    status: 'PAYMENT_PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: 'UPI',
    scheduledDate: '2026-11-05',
    scheduledTimeSlot: '09:00 - 12:00',
    pickupAddress: { street: 'Shop No. G-246, 40 Foota Road' },
    items: [],
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

  const sampleDto: CreateBookingDto = {
    pickupAddressId: '66fa3b5b1a2c3d4e5f678901',
    pickupSlotId: '66fa3b5b1a2c3d4e5f678902',
    scheduledDate: '2026-11-05',
    scheduledTimeSlot: '09:00 - 12:00',
    items: [
      {
        serviceId: '66fa3b5b1a2c3d4e5f678900',
        serviceName: 'Dry Cleaning',
        itemType: 'Men Two-Piece Suit',
        quantity: 2,
      },
    ],
  };

  beforeEach(async () => {
    const mockBookingsService = {
      createBooking: jest.fn().mockResolvedValue(mockBookingResponse),
      getBookingById: jest.fn(),
      getOrderByOrderId: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BookingsController],
      providers: [
        {
          provide: BookingsService,
          useValue: mockBookingsService,
        },
      ],
    }).compile();

    controller = module.get<BookingsController>(BookingsController);
    service = module.get<BookingsService>(BookingsService);
  });

  describe('createBooking', () => {
    it('should delegate to bookingsService.createBooking with headers, dto, and user', async () => {
      const user = { _id: 'user-123' };
      const idempotencyKey = 'idempotency-key-xyz';

      const result = await controller.createBooking(idempotencyKey, sampleDto, user);

      expect(result).toBe(mockBookingResponse);
      expect(service.createBooking).toHaveBeenCalledWith(sampleDto, idempotencyKey, user);
    });
  });

  describe('getBookingById', () => {
    it('should return booking when found', async () => {
      const mockBooking = { _id: '66fa3b5b1a2c3d4e5f678903' };
      (service.getBookingById as jest.Mock).mockResolvedValue(mockBooking);

      const result = await controller.getBookingById('66fa3b5b1a2c3d4e5f678903');
      expect(result).toBe(mockBooking);
      expect(service.getBookingById).toHaveBeenCalledWith('66fa3b5b1a2c3d4e5f678903');
    });

    it('should throw NotFoundException when booking not found', async () => {
      (service.getBookingById as jest.Mock).mockResolvedValue(null);

      await expect(controller.getBookingById('66fa3b5b1a2c3d4e5f678903')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getOrderByOrderId', () => {
    it('should return order when found', async () => {
      const mockOrder = { orderId: 'TC402736' };
      (service.getOrderByOrderId as jest.Mock).mockResolvedValue(mockOrder);

      const result = await controller.getOrderByOrderId('TC402736');
      expect(result).toBe(mockOrder);
      expect(service.getOrderByOrderId).toHaveBeenCalledWith('TC402736');
    });

    it('should throw NotFoundException when order not found', async () => {
      (service.getOrderByOrderId as jest.Mock).mockResolvedValue(null);

      await expect(controller.getOrderByOrderId('TC999999')).rejects.toThrow(NotFoundException);
    });
  });
});
