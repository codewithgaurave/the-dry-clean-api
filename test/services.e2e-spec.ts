import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, HttpStatus } from '@nestjs/common';
import * as request from 'supertest';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ServicesController } from '../src/services/services.controller';
import { ServicesService } from '../src/services/services.service';
import { Service, ServicePrice } from '../src/database/schemas/service.schema';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

describe('ServicesController (e2e)', () => {
  let app: INestApplication;
  let serviceModel: any;
  let servicePriceModel: any;

  const mockServiceAId = new Types.ObjectId();
  const mockServiceBId = new Types.ObjectId();

  const mockServiceA = {
    _id: mockServiceAId,
    name: 'Dry Cleaning',
    category: 'DRY_CLEAN',
    description: 'Eco-friendly solvent dry cleaning',
    icon: 'dry_cleaning',
    turnaroundTime: '48-72 Hours',
    turnaroundHours: 48,
    active: true,
  };

  const mockServiceB = {
    _id: mockServiceBId,
    name: 'Premium Laundry',
    category: 'PREMIUM_LAUNDRY',
    description: 'Gentle temperature washing',
    icon: 'local_laundry_service',
    turnaroundTime: '24-48 Hours',
    turnaroundHours: 24,
    active: true,
  };

  const mockPricesA = [
    {
      _id: new Types.ObjectId(),
      serviceId: mockServiceAId,
      itemType: "Men's Suit (2-Piece)",
      package: 'Standard',
      unit: 'piece',
      amountMinor: 35000,
      currency: 'INR',
      isAddon: false,
    },
    {
      _id: new Types.ObjectId(),
      serviceId: mockServiceAId,
      itemType: 'Intensive Stain Removal',
      unit: 'piece',
      amountMinor: 10000,
      currency: 'INR',
      isAddon: true,
      description: 'Enzyme stain treatment',
    },
  ];

  beforeAll(async () => {
    serviceModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn().mockResolvedValue(2),
      create: jest.fn(),
    };

    servicePriceModel = {
      find: jest.fn(),
      create: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ServicesController],
      providers: [
        ServicesService,
        { provide: getModelToken(Service.name), useValue: serviceModel },
        { provide: getModelToken(ServicePrice.name), useValue: servicePriceModel },
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
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /v1/services', () => {
    it('returns 200 with formatted active services catalogue', async () => {
      serviceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockServiceA, mockServiceB]),
        }),
      });

      servicePriceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPricesA),
        }),
      });

      const res = await request(app.getHttpServer()).get('/v1/services').expect(HttpStatus.OK);

      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe(mockServiceAId.toString());
      expect(res.body[0].name).toBe('Dry Cleaning');
      expect(res.body[0].startingPriceFormatted).toBe('₹350.00');
      expect(res.body[0].items).toHaveLength(1);
      expect(res.body[0].addons).toHaveLength(1);
      expect(res.body[0].packages).toContain('Standard');
    });

    it('filters services by category query parameter', async () => {
      serviceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockServiceA]),
        }),
      });

      servicePriceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPricesA),
        }),
      });

      const res = await request(app.getHttpServer())
        .get('/v1/services?category=dry_clean')
        .expect(HttpStatus.OK);

      expect(res.body).toHaveLength(1);
      expect(serviceModel.find).toHaveBeenCalledWith({
        active: true,
        category: 'DRY_CLEAN',
      });
    });
  });

  describe('GET /v1/services/:id', () => {
    it('returns 200 with detailed service specification and price list', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceA),
      });

      servicePriceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPricesA),
        }),
      });

      const res = await request(app.getHttpServer())
        .get(`/v1/services/${mockServiceAId.toString()}`)
        .expect(HttpStatus.OK);

      expect(res.body.id).toBe(mockServiceAId.toString());
      expect(res.body.name).toBe('Dry Cleaning');
      expect(res.body.items).toHaveLength(1);
      expect(res.body.addons).toHaveLength(1);
      expect(res.body.turnaroundTime).toBe('48-72 Hours');
    });

    it('returns 400 for invalid ObjectId format', async () => {
      await request(app.getHttpServer())
        .get('/v1/services/non-valid-id')
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('returns 404 when service is not found', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const randomId = new Types.ObjectId().toString();
      await request(app.getHttpServer())
        .get(`/v1/services/${randomId}`)
        .expect(HttpStatus.NOT_FOUND);
    });
  });
});
