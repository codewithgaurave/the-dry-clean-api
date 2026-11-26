import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { SupportService } from './support.service';
import {
  SupportTicket,
  SupportTicketType,
  SupportTicketStatus,
  TicketPriority,
} from '../database/schemas/support-ticket.schema';
import { Order } from '../database/schemas/order.schema';

describe('SupportService', () => {
  let service: SupportService;
  let mockSupportTicketModel: any;
  let mockOrderModel: any;

  const mockUserId = new Types.ObjectId().toString();
  const mockOrderId = new Types.ObjectId().toString();

  beforeEach(async () => {
    mockSupportTicketModel = {
      create: jest.fn().mockImplementation((doc) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...doc,
          createdAt: new Date(),
        }),
      ),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: new Types.ObjectId(),
              ticketNumber: 'TKT-402738-1234',
              orderId: 'TC402738',
              type: SupportTicketType.DELIVERY_DISPUTE,
              subject: 'Doorstep photo dispute',
              description: 'Photo does not match my doorstep',
              status: SupportTicketStatus.OPEN,
              priority: TicketPriority.HIGH,
              createdAt: new Date(),
            },
          ]),
        }),
      }),
    };

    mockOrderModel = {
      findOne: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(mockOrderId),
        orderId: 'TC402738',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupportService,
        {
          provide: getModelToken(SupportTicket.name),
          useValue: mockSupportTicketModel,
        },
        {
          provide: getModelToken(Order.name),
          useValue: mockOrderModel,
        },
      ],
    }).compile();

    service = module.get<SupportService>(SupportService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTicket', () => {
    it('creates a support ticket linked to an order with correct number', async () => {
      const dto = {
        subject: 'Garment inquiry',
        description: 'Need extra delicate wash for silk scarf',
        orderId: 'TC402738',
        category: 'ORDER_ISSUE',
        priority: 'HIGH',
      };

      const result = await service.createTicket(mockUserId, dto);

      expect(mockOrderModel.findOne).toHaveBeenCalled();
      expect(mockSupportTicketModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Garment inquiry',
          type: SupportTicketType.ORDER_ISSUE,
          priority: TicketPriority.HIGH,
          status: SupportTicketStatus.OPEN,
        }),
      );
      expect(result.ticketNumber).toMatch(/^TKT-TC402738-/);
      expect(result.subject).toBe(dto.subject);
    });

    it('creates a general inquiry ticket without orderId', async () => {
      const dto = {
        subject: 'General pricing question',
        description: 'How much for leather jacket conditioning?',
        category: 'GENERAL',
      };

      const result = await service.createTicket(mockUserId, dto);

      expect(result.orderId).toBe('GENERAL');
      expect(result.type).toBe(SupportTicketType.OTHER);
      expect(result.priority).toBe(TicketPriority.MEDIUM);
      expect(result.ticketNumber).toMatch(/^TKT-/);
    });
  });

  describe('getUserTickets', () => {
    it('returns chronological list of tickets for user', async () => {
      const tickets = await service.getUserTickets(mockUserId);

      expect(mockSupportTicketModel.find).toHaveBeenCalled();
      expect(tickets.length).toBe(1);
      expect(tickets[0].ticketNumber).toBe('TKT-402738-1234');
    });
  });

  describe('getFaqs', () => {
    it('returns all FAQs by default', () => {
      const faqs = service.getFaqs();
      expect(faqs.length).toBeGreaterThan(0);
      expect(faqs.some((f) => f.id === 'faq-pod-1')).toBe(true);
      expect(faqs.some((f) => f.id === 'faq-privacy-2')).toBe(true);
    });

    it('filters FAQs by category', () => {
      const deliveryFaqs = service.getFaqs('Delivery');
      expect(deliveryFaqs.every((f) => f.category.includes('Delivery'))).toBe(true);
    });

    it('filters FAQs by keyword query', () => {
      const searchFaqs = service.getFaqs(undefined, 'guarantee');
      expect(searchFaqs.length).toBeGreaterThan(0);
      expect(searchFaqs[0].question.toLowerCase()).toContain('guarantee');
    });
  });
});
