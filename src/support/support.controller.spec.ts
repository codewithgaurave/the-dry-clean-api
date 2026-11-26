import { Test, TestingModule } from '@nestjs/testing';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { Types } from 'mongoose';

describe('SupportController', () => {
  let controller: SupportController;
  let mockSupportService: any;

  const mockUser: any = {
    _id: new Types.ObjectId(),
    phone: '+919718312383',
    name: 'Test Customer',
  };

  beforeEach(async () => {
    mockSupportService = {
      createTicket: jest.fn().mockResolvedValue({
        id: 'tkt_123',
        ticketNumber: 'TKT-402738-9821',
        orderId: 'TC402738',
        subject: 'Garment inquiry',
        description: 'Silk care query',
        status: 'OPEN',
        priority: 'MEDIUM',
        createdAt: new Date(),
      }),
      getUserTickets: jest.fn().mockResolvedValue([
        {
          id: 'tkt_123',
          ticketNumber: 'TKT-402738-9821',
          subject: 'Garment inquiry',
          status: 'OPEN',
        },
      ]),
      getFaqs: jest.fn().mockReturnValue([
        {
          id: 'faq-1',
          category: 'Delivery & Proof',
          question: 'How does Photo Proof of Delivery work?',
          answer: 'Photo proof is taken at doorstep.',
        },
      ]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupportController],
      providers: [
        {
          provide: SupportService,
          useValue: mockSupportService,
        },
      ],
    }).compile();

    controller = module.get<SupportController>(SupportController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getFaqs', () => {
    it('returns list of FAQs', () => {
      const result = controller.getFaqs('Delivery & Proof', 'photo');
      expect(mockSupportService.getFaqs).toHaveBeenCalledWith('Delivery & Proof', 'photo');
      expect(result.length).toBe(1);
    });
  });

  describe('createTicket', () => {
    it('calls supportService.createTicket with user and dto', async () => {
      const dto = {
        subject: 'Garment inquiry',
        description: 'Silk care query',
        orderId: 'TC402738',
      };

      const result = await controller.createTicket(mockUser, dto);

      expect(mockSupportService.createTicket).toHaveBeenCalledWith(mockUser._id.toString(), dto);
      expect(result.ticketNumber).toBe('TKT-402738-9821');
    });
  });

  describe('getUserTickets', () => {
    it('calls supportService.getUserTickets with user id', async () => {
      const result = await controller.getUserTickets(mockUser);
      expect(mockSupportService.getUserTickets).toHaveBeenCalledWith(mockUser._id.toString());
      expect(result.length).toBe(1);
    });
  });
});
