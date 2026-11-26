import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SlotsController } from '../src/slots/slots.controller';
import { SlotsService } from '../src/slots/slots.service';
import { PickupSlot, SlotKey } from '../src/database/schemas/pickup-slot.schema';
import { Booking } from '../src/database/schemas/booking.schema';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('SlotsController (e2e)', () => {
  let app: INestApplication;
  let pickupSlotModel: any;
  let bookingModel: any;

  const mockDate = '2028-12-15'; // Definite future date
  const mockMorningId = new Types.ObjectId();
  const mockAfternoonId = new Types.ObjectId();
  const mockEveningId = new Types.ObjectId();

  const mockSlots = [
    {
      _id: mockMorningId,
      date: mockDate,
      slotKey: SlotKey.MORNING,
      label: 'Morning',
      timeWindow: '09:00 - 12:00',
      startTime: '09:00',
      endTime: '12:00',
      capacity: 10,
      bookedCount: 0,
      cutoffHours: 2,
      serviceArea: 'ALL',
      isActive: true,
    },
    {
      _id: mockAfternoonId,
      date: mockDate,
      slotKey: SlotKey.AFTERNOON,
      label: 'Afternoon',
      timeWindow: '13:00 - 16:00',
      startTime: '13:00',
      endTime: '16:00',
      capacity: 10,
      bookedCount: 10, // Full capacity
      cutoffHours: 2,
      serviceArea: 'ALL',
      isActive: true,
    },
    {
      _id: mockEveningId,
      date: mockDate,
      slotKey: SlotKey.EVENING,
      label: 'Evening',
      timeWindow: '17:00 - 20:00',
      startTime: '17:00',
      endTime: '20:00',
      capacity: 10,
      bookedCount: 3,
      cutoffHours: 2,
      serviceArea: 'ALL',
      isActive: true,
    },
  ];

  beforeAll(async () => {
    pickupSlotModel = {
      find: jest.fn().mockImplementation((query: any) => {
        if (query.date === mockDate) {
          return Promise.resolve(mockSlots);
        }
        return Promise.resolve([]);
      }),
      findOne: jest.fn(),
      findById: jest.fn(),
      create: jest.fn().mockImplementation((dto: any) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...dto,
        }),
      ),
    };

    bookingModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockResolvedValue([]),
      }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [SlotsController],
      providers: [
        SlotsService,
        {
          provide: getModelToken(PickupSlot.name),
          useValue: pickupSlotModel,
        },
        {
          provide: getModelToken(Booking.name),
          useValue: bookingModel,
        },
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

  describe('GET /v1/pickup-slots', () => {
    it('should return 200 with available pickup slots for future date', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/pickup-slots?date=${mockDate}`)
        .expect(HttpStatus.OK);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(3);

      const morning = res.body.find((s: any) => s.slotKey === 'MORNING');
      expect(morning).toBeDefined();
      expect(morning.label).toBe('Morning');
      expect(morning.timeWindow).toBe('09:00 - 12:00');
      expect(morning.isAvailable).toBe(true);
      expect(morning.remainingCapacity).toBe(10);
      expect(morning.cutoffTime).toBe('07:00');

      const afternoon = res.body.find((s: any) => s.slotKey === 'AFTERNOON');
      expect(afternoon).toBeDefined();
      expect(afternoon.isAvailable).toBe(false);
      expect(afternoon.unavailableReason).toBe('CAPACITY_REACHED');
      expect(afternoon.remainingCapacity).toBe(0);

      const evening = res.body.find((s: any) => s.slotKey === 'EVENING');
      expect(evening).toBeDefined();
      expect(evening.isAvailable).toBe(true);
      expect(evening.remainingCapacity).toBe(7);
    });

    it('should return 400 Bad Request when date parameter is missing', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/pickup-slots')
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body).toBeDefined();
      expect(res.body.statusCode).toBe(400);
    });

    it('should return 400 Bad Request when date is in invalid format', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/pickup-slots?date=05-11-2026')
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body).toBeDefined();
      expect(res.body.statusCode).toBe(400);
    });

    it('should return 400 Bad Request when date is in the past', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/pickup-slots?date=2020-01-01')
        .expect(HttpStatus.BAD_REQUEST);

      expect(res.body).toBeDefined();
      expect(res.body.statusCode).toBe(400);
      expect(res.body.message).toMatch(/Date cannot be in the past/i);
    });

    it('should filter slots by serviceArea / pincode when provided', async () => {
      const res = await request(app.getHttpServer())
        .get(`/v1/pickup-slots?date=${mockDate}&serviceArea=110044`)
        .expect(HttpStatus.OK);

      expect(Array.isArray(res.body)).toBe(true);
      expect(pickupSlotModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          date: mockDate,
          serviceArea: '110044',
        }),
      );
    });
  });
});
