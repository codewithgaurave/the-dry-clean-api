import { NotFoundException, BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { OrderTransitionService } from './order-transition.service';
import { OrderStateMachineService } from './order-state-machine.service';
import { DatabaseService } from '../database/database.service';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { Order } from '../database/schemas/order.schema';
import { OrderStatusEvent } from '../database/schemas/order-status-event.schema';
import { OrderStatus, OrderActorRole } from './order-status.enum';

describe('OrderTransitionService', () => {
  let service: OrderTransitionService;
  let mockOrderModel: any;
  let mockEventModel: any;
  let mockStateMachine: any;
  let mockDatabaseService: any;
  let mockOutboxPublisher: any;
  let mockSession: any;

  const sampleOrder = {
    _id: new Types.ObjectId(),
    orderId: 'TC402736',
    status: OrderStatus.CONFIRMED,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  beforeEach(async () => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
      inTransaction: jest.fn().mockReturnValue(true),
    };

    mockDatabaseService = {
      withTransaction: jest.fn().mockImplementation(async (cb) => {
        return cb(mockSession);
      }),
    };

    mockOutboxPublisher = {
      publish: jest.fn().mockResolvedValue({ _id: 'outbox_msg_123' }),
    };

    mockOrderModel = {
      findOne: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue({ ...sampleOrder }),
      }),
    };

    mockEventModel = {
      create: jest.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          orderId: 'TC402736',
          previousStatus: OrderStatus.CONFIRMED,
          status: OrderStatus.PICKUP_SCHEDULED,
          timestamp: new Date(),
        },
      ]),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { orderId: 'TC402736', status: OrderStatus.CONFIRMED },
            { orderId: 'TC402736', status: OrderStatus.PICKUP_SCHEDULED },
          ]),
        }),
      }),
    };

    mockStateMachine = {
      validateTransition: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderTransitionService,
        { provide: getModelToken(Order.name), useValue: mockOrderModel },
        { provide: getModelToken(OrderStatusEvent.name), useValue: mockEventModel },
        { provide: OrderStateMachineService, useValue: mockStateMachine },
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: OutboxPublisherService, useValue: mockOutboxPublisher },
      ],
    }).compile();

    service = module.get<OrderTransitionService>(OrderTransitionService);
  });

  describe('transitionOrderStatus', () => {
    it('concurrently updates order status, logs immutable event, and enqueues Outbox event within transaction', async () => {
      const result = await service.transitionOrderStatus('TC402736', OrderStatus.PICKUP_SCHEDULED, {
        actorRole: OrderActorRole.OPERATIONS,
        actorId: 'ops_user_1',
        note: 'Scheduled for tomorrow morning',
      });

      expect(mockDatabaseService.withTransaction).toHaveBeenCalled();
      expect(mockOrderModel.findOne).toHaveBeenCalledWith({ orderId: 'TC402736' });
      expect(mockStateMachine.validateTransition).toHaveBeenCalledWith(
        OrderStatus.CONFIRMED,
        OrderStatus.PICKUP_SCHEDULED,
        expect.any(Object),
      );

      expect(result.order.status).toBe(OrderStatus.PICKUP_SCHEDULED);
      expect(mockEventModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            orderId: 'TC402736',
            previousStatus: OrderStatus.CONFIRMED,
            status: OrderStatus.PICKUP_SCHEDULED,
            updatedBy: {
              actorRole: OrderActorRole.OPERATIONS,
              actorId: 'ops_user_1',
            },
          }),
        ],
        { session: mockSession },
      );

      // Verify Transactional Outbox write within same session (TASK-011)
      expect(mockOutboxPublisher.publish).toHaveBeenCalledWith(
        'ORDER_STATUS_CHANGED',
        expect.objectContaining({
          orderId: 'TC402736',
          previousStatus: OrderStatus.CONFIRMED,
          status: OrderStatus.PICKUP_SCHEDULED,
        }),
        mockSession,
      );
    });

    it('throws NotFoundException when order does not exist', async () => {
      mockOrderModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue(null),
      });

      await expect(
        service.transitionOrderStatus('TC_NONEXISTENT', OrderStatus.PICKUP_SCHEDULED, {
          actorRole: OrderActorRole.OPERATIONS,
          actorId: 'ops_1',
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockStateMachine.validateTransition).not.toHaveBeenCalled();
      expect(mockEventModel.create).not.toHaveBeenCalled();
      expect(mockOutboxPublisher.publish).not.toHaveBeenCalled();
    });

    it('aborts transition when state machine validation fails', async () => {
      mockStateMachine.validateTransition.mockImplementation(() => {
        throw new BadRequestException('FORBIDDEN_TRANSITION: Invalid hop');
      });

      await expect(
        service.transitionOrderStatus('TC402736', OrderStatus.DELIVERED, {
          actorRole: OrderActorRole.CUSTOMER,
          actorId: 'cust_1',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockEventModel.create).not.toHaveBeenCalled();
      expect(mockOutboxPublisher.publish).not.toHaveBeenCalled();
    });

    it('aborts order update if appending the audit event fails', async () => {
      mockEventModel.create.mockRejectedValue(new Error('Event write error'));

      await expect(
        service.transitionOrderStatus('TC402736', OrderStatus.PICKUP_SCHEDULED, {
          actorRole: OrderActorRole.OPERATIONS,
          actorId: 'ops_1',
        }),
      ).rejects.toThrow('Event write error');
    });

    it('attaches pickupProofId when transitioning to PICKED_UP with valid proofId', async () => {
      const validProofId = new Types.ObjectId().toHexString();
      mockOrderModel.findOne.mockReturnValue({
        session: jest.fn().mockResolvedValue({
          ...sampleOrder,
          status: OrderStatus.PICKUP_SCHEDULED,
        }),
      });

      const result = await service.transitionOrderStatus('TC402736', OrderStatus.PICKED_UP, {
        actorRole: OrderActorRole.AGENT,
        actorId: 'agent_1',
        proofId: validProofId,
      });

      expect(result.order.status).toBe(OrderStatus.PICKED_UP);
      expect(result.order.pickupProofId?.toHexString()).toBe(validProofId);
      expect(mockOutboxPublisher.publish).toHaveBeenCalledWith(
        'ORDER_STATUS_CHANGED',
        expect.objectContaining({
          status: OrderStatus.PICKED_UP,
          proofId: validProofId,
        }),
        mockSession,
      );
    });
  });

  describe('getOrderEventHistory', () => {
    it('returns sorted historical events list for tracking timeline', async () => {
      const history = await service.getOrderEventHistory('TC402736');

      expect(mockEventModel.find).toHaveBeenCalledWith({ orderId: 'TC402736' });
      expect(history.length).toBe(2);
      expect(history[0].status).toBe(OrderStatus.CONFIRMED);
    });
  });
});
