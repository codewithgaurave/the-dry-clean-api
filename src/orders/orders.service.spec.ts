import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrdersService } from './orders.service';
import { Order } from '../database/schemas/order.schema';
import { OrderStatusEvent } from '../database/schemas/order-status-event.schema';
import { DeliveryTask } from '../database/schemas/delivery-task.schema';
import {
  OrderProof,
  ProofType,
  HandoverMethod,
  ProofReviewStatus,
} from '../database/schemas/order-proof.schema';
import {
  SupportTicket,
  SupportTicketStatus,
  TicketPriority,
} from '../database/schemas/support-ticket.schema';
import { StorageService } from '../storage/storage.service';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { OrderTransitionService } from './order-transition.service';
import { OrderStatus } from './order-status.enum';

describe('OrdersService', () => {
  let service: OrdersService;
  let mockOrderModel: any;
  let mockOrderStatusEventModel: any;
  let mockDeliveryTaskModel: any;
  let mockOrderProofModel: any;
  let mockSupportTicketModel: any;
  let mockStorageService: any;
  let mockOutboxPublisher: any;
  let mockOrderTransitionService: any;

  const mockCustomerAId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678901');
  const mockCustomerBId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678902');

  const sampleOrderA = {
    _id: new Types.ObjectId('66fa3b5b1a2c3d4e5f678910'),
    orderId: 'TC402736',
    userId: mockCustomerAId,
    status: OrderStatus.CONFIRMED,
    paymentStatus: 'PAID',
    paymentMethod: 'UPI',
    items: [
      {
        serviceName: 'Dry Clean',
        itemType: 'Suit',
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
      street: '42 Atelier Luxury Boulevard',
      city: 'Gurugram',
      state: 'Haryana',
      pincode: '122001',
    },
    createdAt: new Date('2026-11-01T10:00:00Z'),
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  const sampleEventA = {
    _id: new Types.ObjectId(),
    orderId: 'TC402736',
    orderRef: sampleOrderA._id,
    previousStatus: OrderStatus.DRAFT,
    status: OrderStatus.CONFIRMED,
    timestamp: new Date('2026-11-01T10:00:00Z'),
    updatedBy: { actorRole: 'SYSTEM', actorId: 'SYS_01' },
  };

  beforeEach(async () => {
    mockOrderModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    mockOrderStatusEventModel = {
      find: jest.fn(),
      create: jest.fn(),
    };

    mockDeliveryTaskModel = {
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
    };

    mockOrderTransitionService = {
      transitionOrderStatus: jest.fn(),
    };

    mockOrderProofModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      countDocuments: jest.fn(),
    };

    mockSupportTicketModel = jest.fn().mockImplementation((data) => ({
      ...data,
      _id: new Types.ObjectId(),
      save: jest.fn().mockResolvedValue({
        ...data,
        _id: new Types.ObjectId(),
        createdAt: new Date('2026-11-01T12:00:00Z'),
      }),
    }));

    mockStorageService = {
      getSignedDownloadUrl: jest
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(`https://s3.signed-url.com/${key}?signature=valid`),
        ),
    };

    mockOutboxPublisher = {
      publish: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        {
          provide: getModelToken(Order.name),
          useValue: mockOrderModel,
        },
        {
          provide: getModelToken(OrderStatusEvent.name),
          useValue: mockOrderStatusEventModel,
        },
        {
          provide: getModelToken(DeliveryTask.name),
          useValue: mockDeliveryTaskModel,
        },
        {
          provide: getModelToken(OrderProof.name),
          useValue: mockOrderProofModel,
        },
        {
          provide: getModelToken(SupportTicket.name),
          useValue: mockSupportTicketModel,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: OutboxPublisherService,
          useValue: mockOutboxPublisher,
        },
        {
          provide: OrderTransitionService,
          useValue: mockOrderTransitionService,
        },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('listCustomerOrders', () => {
    it('should list paginated orders for the authenticated customer', async () => {
      const mockQueryChain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([sampleOrderA]),
      };
      mockOrderModel.find.mockReturnValue(mockQueryChain);
      mockOrderModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      const result = await service.listCustomerOrders(mockCustomerAId, {
        page: 1,
        limit: 10,
      });

      expect(mockOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockCustomerAId }),
      );
      expect(result.orders).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('should filter active orders excluding DELIVERED and CANCELLED', async () => {
      const mockQueryChain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([sampleOrderA]),
      };
      mockOrderModel.find.mockReturnValue(mockQueryChain);
      mockOrderModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      await service.listCustomerOrders(mockCustomerAId, {
        status: 'active',
      });

      expect(mockOrderModel.find).toHaveBeenCalledWith({
        userId: mockCustomerAId,
        status: { $nin: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] },
      });
    });

    it('should filter past orders including only DELIVERED and CANCELLED', async () => {
      const mockQueryChain = {
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      mockOrderModel.find.mockReturnValue(mockQueryChain);
      mockOrderModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(0),
      });

      await service.listCustomerOrders(mockCustomerAId, {
        status: 'past',
      });

      expect(mockOrderModel.find).toHaveBeenCalledWith({
        userId: mockCustomerAId,
        status: { $in: [OrderStatus.DELIVERED, OrderStatus.CANCELLED] },
      });
    });
  });

  describe('getCustomerOrderById & Tenancy', () => {
    it('should return order when owned by requesting customer', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      const order = await service.getCustomerOrderById(mockCustomerAId, 'TC402736');

      expect(order).toBeDefined();
      expect(order.orderId).toBe('TC402736');
      expect(mockOrderModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ userId: mockCustomerAId }),
      );
    });

    it('should throw NotFoundException when order does not belong to customer', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getCustomerOrderById(mockCustomerBId, 'TC402736')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getCustomerOrderEvents & Tenancy', () => {
    it('should return chronological status events when order is owned by customer', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      const mockEventQueryChain = {
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([sampleEventA]),
      };
      mockOrderStatusEventModel.find.mockReturnValue(mockEventQueryChain);

      const events = await service.getCustomerOrderEvents(mockCustomerAId, 'TC402736');

      expect(events).toHaveLength(1);
      expect(events[0].status).toBe(OrderStatus.CONFIRMED);
      expect(mockEventQueryChain.sort).toHaveBeenCalledWith({
        timestamp: 1,
        createdAt: 1,
      });
    });

    it('should deny access to events if customer does not own the order', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getCustomerOrderEvents(mockCustomerBId, 'TC402736')).rejects.toThrow(
        NotFoundException,
      );

      expect(mockOrderStatusEventModel.find).not.toHaveBeenCalled();
    });
  });

  describe('cancelCustomerOrder (TASK-033)', () => {
    it('should cancel an eligible order in CONFIRMED status and update DeliveryTasks', async () => {
      const confirmedOrder = { ...sampleOrderA, status: OrderStatus.CONFIRMED };
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(confirmedOrder),
      });

      const cancelledOrder = { ...confirmedOrder, status: OrderStatus.CANCELLED };
      mockOrderTransitionService.transitionOrderStatus.mockResolvedValue({
        order: cancelledOrder,
        event: { status: OrderStatus.CANCELLED },
      });

      const result = await service.cancelCustomerOrder(mockCustomerAId, 'TC402736', {
        reason: 'Customer travelling out of city',
      });

      expect(result.status).toBe(OrderStatus.CANCELLED);
      expect(mockOrderTransitionService.transitionOrderStatus).toHaveBeenCalledWith(
        'TC402736',
        OrderStatus.CANCELLED,
        expect.objectContaining({
          note: 'Customer travelling out of city',
        }),
      );
      expect(mockDeliveryTaskModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'TC402736' }),
        expect.any(Object),
      );
    });

    it('should reject cancellation with BadRequestException if order is in CLEANING_IN_PROGRESS', async () => {
      const inCleaningOrder = {
        ...sampleOrderA,
        status: OrderStatus.CLEANING_IN_PROGRESS,
      };
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(inCleaningOrder),
      });

      await expect(service.cancelCustomerOrder(mockCustomerAId, 'TC402736')).rejects.toThrow(
        BadRequestException,
      );

      expect(mockOrderTransitionService.transitionOrderStatus).not.toHaveBeenCalled();
    });
  });

  describe('rescheduleCustomerOrder (TASK-033)', () => {
    it('should reschedule pickup window for order in PICKUP_SCHEDULED status', async () => {
      const scheduledOrder = {
        ...sampleOrderA,
        status: OrderStatus.PICKUP_SCHEDULED,
        save: jest.fn().mockImplementation(function () {
          return Promise.resolve(this);
        }),
      };
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(scheduledOrder),
      });

      mockOrderTransitionService.transitionOrderStatus.mockResolvedValue({
        order: scheduledOrder,
        event: { status: OrderStatus.RESCHEDULED },
      });

      const result = await service.rescheduleCustomerOrder(mockCustomerAId, 'TC402736', {
        date: '2026-10-30',
        timeSlot: '16:00 - 18:00',
        reason: 'Available only in evening',
      });

      expect(result.status).toBe(OrderStatus.RESCHEDULED);
      expect(result.currentScheduledWindow).toEqual({
        type: 'PICKUP',
        date: '2026-10-30',
        timeSlot: '16:00 - 18:00',
      });
      expect(mockDeliveryTaskModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'TC402736' }),
        expect.objectContaining({
          $set: expect.objectContaining({
            scheduledDate: '2026-10-30',
            scheduledTimeWindow: '16:00 - 18:00',
          }),
        }),
      );
    });

    it('should reject rescheduling with BadRequestException if garments already collected', async () => {
      const pickedUpOrder = {
        ...sampleOrderA,
        status: OrderStatus.PICKED_UP,
      };
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(pickedUpOrder),
      });

      await expect(
        service.rescheduleCustomerOrder(mockCustomerAId, 'TC402736', {
          date: '2026-10-30',
          timeSlot: '16:00 - 18:00',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCustomerOrderProofs (TASK-040)', () => {
    const sampleProof = {
      _id: new Types.ObjectId('6724fa10b91e70c53e0d8b99'),
      orderId: 'TC402736',
      orderRef: sampleOrderA._id,
      taskId: 'TSK_D_402736',
      type: ProofType.DELIVERY,
      handoverMethod: HandoverMethod.HANDED_TO_CUSTOMER,
      photoKeys: ['proofs/TSK_D_402736_1.jpg', 'proofs/TSK_D_402736_2.jpg'],
      capturedAt: new Date('2026-10-31T15:30:00Z'),
      receivedAt: new Date('2026-10-31T15:30:05Z'),
      note: 'Delivered directly to concierge desk',
      reviewStatus: ProofReviewStatus.PENDING,
    };

    it('should return proofs with signed S3 download URLs for customer order', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      mockOrderProofModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([sampleProof]),
        }),
      });

      const results = await service.getCustomerOrderProofs(mockCustomerAId, 'TC402736');

      expect(results).toHaveLength(1);
      expect(results[0].orderId).toBe('TC402736');
      expect(results[0].type).toBe('DELIVERY');
      expect(results[0].handoverMethod).toBe('HANDED_TO_CUSTOMER');
      expect(results[0].photoUrls).toHaveLength(2);
      expect(results[0].photoUrls[0]).toContain('https://s3.signed-url.com/');
      expect(mockStorageService.getSignedDownloadUrl).toHaveBeenCalledWith(
        'proofs/TSK_D_402736_1.jpg',
        900,
      );
    });

    it('should throw NotFoundException if order does not belong to requesting customer', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(service.getCustomerOrderProofs(mockCustomerBId, 'TC402736')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('reportCustomerOrderIssue (TASK-040)', () => {
    const sampleProof = {
      _id: new Types.ObjectId('6724fa10b91e70c53e0d8b99'),
      orderId: 'TC402736',
      orderRef: sampleOrderA._id,
      reviewStatus: ProofReviewStatus.PENDING,
      save: jest.fn().mockImplementation(function () {
        return Promise.resolve(this);
      }),
    };

    it('should create SupportTicket linked to order & proof and flag the proof for review', async () => {
      const orderWithProof = {
        ...sampleOrderA,
        deliveryProofId: sampleProof._id,
      };
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(orderWithProof),
      });

      mockOrderProofModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleProof),
      });

      const dto = {
        reason: 'PACKAGE_NOT_RECEIVED',
        description: 'Photo shows wrong apartment doorstep. Did not receive items.',
        proofId: sampleProof._id.toString(),
      };

      const result = await service.reportCustomerOrderIssue(mockCustomerAId, 'TC402736', dto);

      expect(result.orderId).toBe('TC402736');
      expect(result.ticketNumber).toMatch(/^TKT-TC402736-\d{4}$/);
      expect(result.status).toBe(SupportTicketStatus.OPEN);
      expect(result.priority).toBe(TicketPriority.HIGH);
      expect(sampleProof.reviewStatus).toBe(ProofReviewStatus.FLAGGED);
      expect(sampleProof.save).toHaveBeenCalled();
      expect(mockOutboxPublisher.publish).toHaveBeenCalledWith(
        'SUPPORT_TICKET_CREATED',
        expect.objectContaining({
          orderId: 'TC402736',
          reason: 'PACKAGE_NOT_RECEIVED',
        }),
      );
    });

    it('should reject issue reporting if order does not belong to customer', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.reportCustomerOrderIssue(mockCustomerBId, 'TC402736', {
          reason: 'PACKAGE_NOT_RECEIVED',
          description: 'Cannot see my order',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject with BadRequestException if provided proofId does not belong to order', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      mockOrderProofModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null), // Proof not found for this order
      });

      const alienProofId = new Types.ObjectId().toString();
      await expect(
        service.reportCustomerOrderIssue(mockCustomerAId, 'TC402736', {
          reason: 'WRONG_LOCATION',
          description: 'Disputing proof that belongs to another order',
          proofId: alienProofId,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Admin Order Operations', () => {
    it('listAdminOrders returns paginated orders with status filtering', async () => {
      const mockQueryChain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([sampleOrderA]),
      };
      mockOrderModel.find.mockReturnValue(mockQueryChain);
      mockOrderModel.countDocuments.mockReturnValue({
        exec: jest.fn().mockResolvedValue(1),
      });

      const res = await service.listAdminOrders({
        status: 'CONFIRMED',
        page: 1,
        limit: 10,
      });

      expect(mockOrderModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'CONFIRMED' }),
      );
      expect(res.orders).toEqual([sampleOrderA]);
      expect(res.total).toBe(1);
      expect(res.totalPages).toBe(1);
    });

    it('getAdminOrderById returns order along with tasks and events', async () => {
      mockOrderModel.findOne.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      const mockTask = { taskId: 'TSK_P_001', orderId: 'TC402736' };
      mockDeliveryTaskModel.find.mockReturnValue({
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockTask]),
      });

      const mockEvent = { orderId: 'TC402736', status: OrderStatus.CONFIRMED };
      mockOrderStatusEventModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([mockEvent]),
      });

      const res = await service.getAdminOrderById('TC402736');

      expect(res.order).toEqual(sampleOrderA);
      expect(res.tasks).toEqual([mockTask]);
      expect(res.events).toEqual([mockEvent]);
    });

    it('updateOrderStatusByAdmin transitions order via orderTransitionService', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      mockOrderTransitionService.transitionOrderStatus.mockResolvedValue({
        order: { ...sampleOrderA, status: OrderStatus.RECEIVED_AT_FACILITY },
        event: { status: OrderStatus.RECEIVED_AT_FACILITY },
      });

      const adminUser: any = {
        _id: new Types.ObjectId(),
        role: 'ADMIN',
        name: 'Aditya Sharma',
      };

      const res = await service.updateOrderStatusByAdmin(
        'TC402736',
        OrderStatus.RECEIVED_AT_FACILITY,
        adminUser,
        'Garments logged into sorting facility.',
      );

      expect(mockOrderTransitionService.transitionOrderStatus).toHaveBeenCalledWith(
        'TC402736',
        OrderStatus.RECEIVED_AT_FACILITY,
        expect.objectContaining({
          actorRole: 'ADMIN',
          note: 'Garments logged into sorting facility.',
        }),
      );
      expect(res.order.status).toBe(OrderStatus.RECEIVED_AT_FACILITY);
    });

    it('assignOrderTaskByAdmin creates delivery task and assigns courier', async () => {
      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      mockDeliveryTaskModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(null),
      });

      const createdTask = {
        taskId: 'TSK_P_TC402736_9999',
        orderId: 'TC402736',
        agentId: new Types.ObjectId(),
        status: 'ASSIGNED',
      };
      mockDeliveryTaskModel.create.mockResolvedValue(createdTask);

      const opsUser: any = {
        _id: new Types.ObjectId(),
        role: 'OPERATIONS',
        name: 'Rajesh Kumar',
      };

      const res = await service.assignOrderTaskByAdmin(
        'TC402736',
        {
          agentId: createdTask.agentId.toString(),
        },
        opsUser,
      );

      expect(res).toEqual(createdTask);
      expect(mockDeliveryTaskModel.create).toHaveBeenCalled();
    });

    it('getAdminProofsReviewQueue returns enriched proofs with signed URLs and pending count', async () => {
      const sampleProof = {
        _id: new Types.ObjectId(),
        orderId: 'TC402738',
        taskId: 'TSK_D_402738',
        type: 'DELIVERY',
        handoverMethod: 'LEFT_AT_DOOR',
        capturedAt: new Date('2026-11-01T10:00:00Z'),
        receivedAt: new Date('2026-11-01T10:00:03Z'),
        photoKeys: ['proofs/photo1.jpg'],
        reviewStatus: 'PENDING',
        save: jest.fn(),
      };

      const mockQueryChain = {
        populate: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([sampleProof]),
      };

      mockOrderProofModel.find.mockReturnValue(mockQueryChain);
      mockOrderProofModel.countDocuments
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(1) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(1) });

      const res = await service.getAdminProofsReviewQueue('PENDING', 1, 20);

      expect(res.proofs.length).toBe(1);
      expect(res.proofs[0].orderId).toBe('TC402738');
      expect(res.proofs[0].clockDriftSeconds).toBe(3);
      expect(res.proofs[0].photoUrls[0]).toContain('https://s3.signed-url.com/');
      expect(res.pendingCount).toBe(1);
    });

    it('reviewAdminProof marks proof as VERIFIED and logs reviewer metadata', async () => {
      const proofId = new Types.ObjectId();
      const mockProof = {
        _id: proofId,
        orderId: 'TC402738',
        taskId: 'TSK_D_402738',
        type: 'DELIVERY',
        reviewStatus: 'PENDING',
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };

      mockOrderProofModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockProof),
      });

      const reviewer: any = {
        _id: new Types.ObjectId(),
        name: 'Aditya Sharma',
        role: 'ADMIN',
      };

      const res = await service.reviewAdminProof(
        proofId.toString(),
        { action: 'VERIFIED' as any },
        reviewer,
      );

      expect(res.success).toBe(true);
      expect(res.proof.reviewStatus).toBe('VERIFIED');
      expect(res.proof.reviewedBy).toBe(reviewer._id.toString());
      expect(mockProof.save).toHaveBeenCalled();
    });

    it('reviewAdminProof marks proof as FLAGGED and generates follow-up SupportTicket', async () => {
      const proofId = new Types.ObjectId();
      const mockProof = {
        _id: proofId,
        orderId: 'TC402738',
        orderRef: new Types.ObjectId(),
        taskId: 'TSK_D_402738',
        type: 'DELIVERY',
        reviewStatus: 'PENDING',
        save: jest.fn().mockImplementation(function (this: any) {
          return Promise.resolve(this);
        }),
      };

      mockOrderProofModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockProof),
      });

      mockOrderModel.findOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue(sampleOrderA),
      });

      mockSupportTicketModel.create = jest.fn().mockResolvedValue({
        ticketNumber: 'TKT-FLG-TC402738-9999',
        status: 'OPEN',
        priority: 'HIGH',
      });

      const reviewer: any = {
        _id: new Types.ObjectId(),
        name: 'Aditya Sharma',
        role: 'ADMIN',
      };

      const res = await service.reviewAdminProof(
        proofId.toString(),
        { action: 'FLAGGED' as any, reason: 'Doorstep does not match address.' },
        reviewer,
      );

      expect(res.success).toBe(true);
      expect(res.proof.reviewStatus).toBe('FLAGGED');
      expect(res.proof.flaggedReason).toBe('Doorstep does not match address.');
      expect(res.ticket?.ticketNumber).toContain('TKT-FLG-TC402738');
    });
  });
});
