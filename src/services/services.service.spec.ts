import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ServicesService } from './services.service';
import { Service, ServicePrice } from '../database/schemas/service.schema';

describe('ServicesService', () => {
  let service: ServicesService;
  let serviceModel: any;
  let servicePriceModel: any;

  const mockServiceId = new Types.ObjectId();
  const mockServiceDoc = {
    _id: mockServiceId,
    name: 'Dry Cleaning',
    category: 'DRY_CLEAN',
    description: 'Eco-friendly dry cleaning',
    icon: 'dry_cleaning',
    turnaroundTime: '48-72 Hours',
    turnaroundHours: 48,
    active: true,
  };

  const mockPrices = [
    {
      _id: new Types.ObjectId(),
      serviceId: mockServiceId,
      itemType: "Men's Suit (2-Piece)",
      package: 'Standard',
      unit: 'piece',
      amountMinor: 35000,
      currency: 'INR',
      isAddon: false,
    },
    {
      _id: new Types.ObjectId(),
      serviceId: mockServiceId,
      itemType: 'Silk Saree',
      package: 'Standard',
      unit: 'piece',
      amountMinor: 30000,
      currency: 'INR',
      isAddon: false,
    },
    {
      _id: new Types.ObjectId(),
      serviceId: mockServiceId,
      itemType: 'Stain Treatment',
      unit: 'piece',
      amountMinor: 10000,
      currency: 'INR',
      isAddon: true,
      description: 'Enzyme stain treatment',
    },
  ];

  beforeEach(async () => {
    serviceModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
      create: jest.fn(),
    };

    servicePriceModel = {
      find: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServicesService,
        { provide: getModelToken(Service.name), useValue: serviceModel },
        { provide: getModelToken(ServicePrice.name), useValue: servicePriceModel },
      ],
    }).compile();

    service = module.get<ServicesService>(ServicesService);
  });

  describe('listServices', () => {
    it('returns formatted services with item prices, add-ons, and starting prices', async () => {
      serviceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([mockServiceDoc]),
        }),
      });

      servicePriceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPrices),
        }),
      });

      const result = await service.listServices();

      expect(result).toHaveLength(1);
      const svc = result[0];
      expect(svc.id).toBe(mockServiceId.toString());
      expect(svc.name).toBe('Dry Cleaning');
      expect(svc.category).toBe('DRY_CLEAN');
      expect(svc.startingPriceMinor).toBe(30000); // Silk Saree is ₹300.00
      expect(svc.startingPriceFormatted).toBe('₹300.00');
      expect(svc.items).toHaveLength(2);
      expect(svc.addons).toHaveLength(1);
      expect(svc.packages).toContain('Standard');
    });

    it('filters services by category in uppercase', async () => {
      serviceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      });

      await service.listServices('dry_clean');

      expect(serviceModel.find).toHaveBeenCalledWith({
        active: true,
        category: 'DRY_CLEAN',
      });
    });
  });

  describe('getServiceById', () => {
    it('returns service by ID with its items and add-ons', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockServiceDoc),
      });

      servicePriceModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(mockPrices),
        }),
      });

      const result = await service.getServiceById(mockServiceId.toString());

      expect(result.id).toBe(mockServiceId.toString());
      expect(result.name).toBe('Dry Cleaning');
      expect(result.items).toHaveLength(2);
      expect(result.addons).toHaveLength(1);
    });

    it('throws BadRequestException for invalid ObjectId format', async () => {
      await expect(service.getServiceById('invalid-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when service does not exist', async () => {
      serviceModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const randomId = new Types.ObjectId().toString();
      await expect(service.getServiceById(randomId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('seedInitialCatalogue', () => {
    it('skips seeding when catalogue already has records', async () => {
      serviceModel.countDocuments.mockResolvedValue(4);

      await service.seedInitialCatalogue();

      expect(serviceModel.create).not.toHaveBeenCalled();
      expect(servicePriceModel.create).not.toHaveBeenCalled();
    });

    it('seeds 4 brand categories with items and add-ons when count is 0', async () => {
      serviceModel.countDocuments.mockResolvedValue(0);
      serviceModel.create.mockImplementation((dto: any) =>
        Promise.resolve({ ...dto, _id: new Types.ObjectId() }),
      );
      servicePriceModel.create.mockResolvedValue({});

      await service.seedInitialCatalogue();

      expect(serviceModel.create).toHaveBeenCalledTimes(4); // Dry Clean, Laundry, Wash & Fold, Steam Press
      expect(servicePriceModel.create).toHaveBeenCalled();
    });
  });
});
