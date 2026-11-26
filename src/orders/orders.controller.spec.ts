import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderStatus } from './order-status.enum';

describe('OrdersController', () => {
  let controller: OrdersController;
  let service: OrdersService;

  const mockUser: any = {
    _id: new Types.ObjectId('66fa3b5b1a2c3d4e5f678901'),
    phone: '+919876543210',
    role: 'CUSTOMER',
  };

  const sampleOrder: any = {
    _id: new Types.ObjectId(),
    orderId: 'TC402736',
    userId: mockUser._id,
    status: OrderStatus.CONFIRMED,
  };

  const sampleEvent: any = {
    orderId: 'TC402736',
    status: OrderStatus.CONFIRMED,
  };

  beforeEach(async () => {
    const mockOrdersService = {
      listCustomerOrders: jest.fn(),
      getCustomerOrderById: jest.fn(),
      getCustomerOrderEvents: jest.fn(),
      cancelCustomerOrder: jest.fn(),
      rescheduleCustomerOrder: jest.fn(),
      getCustomerOrderProofs: jest.fn(),
      reportCustomerOrderIssue: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [
        {
          provide: OrdersService,
          useValue: mockOrdersService,
        },
      ],
    }).compile();

    controller = module.get<OrdersController>(OrdersController);
    service = module.get<OrdersService>(OrdersService);
  });

  describe('listOrders', () => {
    it('should delegate to ordersService.listCustomerOrders with user._id', async () => {
      const paginatedResult = {
        orders: [sampleOrder],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      (service.listCustomerOrders as jest.Mock).mockResolvedValue(paginatedResult);

      const query = { status: 'active', page: 1, limit: 10 };
      const result = await controller.listOrders(mockUser, query);

      expect(service.listCustomerOrders).toHaveBeenCalledWith(mockUser._id, query);
      expect(result).toEqual(paginatedResult);
    });
  });

  describe('getOrderById', () => {
    it('should delegate to ordersService.getCustomerOrderById with user._id', async () => {
      (service.getCustomerOrderById as jest.Mock).mockResolvedValue(sampleOrder);

      const result = await controller.getOrderById(mockUser, 'TC402736');

      expect(service.getCustomerOrderById).toHaveBeenCalledWith(mockUser._id, 'TC402736');
      expect(result).toEqual(sampleOrder);
    });
  });

  describe('getOrderEvents', () => {
    it('should delegate to ordersService.getCustomerOrderEvents with user._id', async () => {
      (service.getCustomerOrderEvents as jest.Mock).mockResolvedValue([sampleEvent]);

      const result = await controller.getOrderEvents(mockUser, 'TC402736');

      expect(service.getCustomerOrderEvents).toHaveBeenCalledWith(mockUser._id, 'TC402736');
      expect(result).toEqual([sampleEvent]);
    });
  });

  describe('cancelOrder (TASK-033)', () => {
    it('should delegate to ordersService.cancelCustomerOrder with user._id, id, and dto', async () => {
      const cancelledOrder = { ...sampleOrder, status: OrderStatus.CANCELLED };
      (service.cancelCustomerOrder as jest.Mock).mockResolvedValue(cancelledOrder);

      const dto = { reason: 'Customer travelling' };
      const result = await controller.cancelOrder(mockUser, 'TC402736', dto);

      expect(service.cancelCustomerOrder).toHaveBeenCalledWith(mockUser._id, 'TC402736', dto);
      expect(result.status).toBe(OrderStatus.CANCELLED);
    });
  });

  describe('rescheduleOrder (TASK-033)', () => {
    it('should delegate to ordersService.rescheduleCustomerOrder with user._id, id, and dto', async () => {
      const rescheduledOrder = { ...sampleOrder, status: OrderStatus.RESCHEDULED };
      (service.rescheduleCustomerOrder as jest.Mock).mockResolvedValue(rescheduledOrder);

      const dto = { date: '2026-10-29', timeSlot: '10:00 - 12:00' };
      const result = await controller.rescheduleOrder(mockUser, 'TC402736', dto);

      expect(service.rescheduleCustomerOrder).toHaveBeenCalledWith(mockUser._id, 'TC402736', dto);
      expect(result.status).toBe(OrderStatus.RESCHEDULED);
    });
  });

  describe('getOrderProofs (TASK-040)', () => {
    it('should delegate to ordersService.getCustomerOrderProofs with user._id and orderId', async () => {
      const mockProofs = [
        {
          id: 'proof-123',
          orderId: 'TC402736',
          taskId: 'TSK_D_402736',
          type: 'DELIVERY',
          handoverMethod: 'HANDED_TO_CUSTOMER',
          capturedAt: '2026-10-31T10:00:00.000Z',
          receivedAt: '2026-10-31T10:00:02.000Z',
          photoUrls: ['https://s3.amazonaws.com/atelier-proofs/photo1.jpg?signed=true'],
          reviewStatus: 'PENDING',
        },
      ];
      (service.getCustomerOrderProofs as jest.Mock).mockResolvedValue(mockProofs);

      const result = await controller.getOrderProofs(mockUser, 'TC402736');

      expect(service.getCustomerOrderProofs).toHaveBeenCalledWith(mockUser._id, 'TC402736');
      expect(result).toEqual(mockProofs);
    });
  });

  describe('reportOrderIssue (TASK-040)', () => {
    it('should delegate to ordersService.reportCustomerOrderIssue with user._id, id, and dto', async () => {
      const mockTicket = {
        ticketId: 'tkt-001',
        ticketNumber: 'TKT-TC402736-1234',
        orderId: 'TC402736',
        type: 'DELIVERY_DISPUTE',
        subject: 'Did not receive package',
        description: 'Wrong doorstep photo',
        status: 'OPEN',
        priority: 'HIGH',
        createdAt: '2026-10-31T10:30:00.000Z',
      };
      (service.reportCustomerOrderIssue as jest.Mock).mockResolvedValue(mockTicket);

      const dto = {
        reason: 'PACKAGE_NOT_RECEIVED',
        description: 'Wrong doorstep photo',
      };
      const result = await controller.reportOrderIssue(mockUser, 'TC402736', dto);

      expect(service.reportCustomerOrderIssue).toHaveBeenCalledWith(mockUser._id, 'TC402736', dto);
      expect(result).toEqual(mockTicket);
    });
  });
});
