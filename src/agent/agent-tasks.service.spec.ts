import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { AgentTasksService } from './agent-tasks.service';
import { DeliveryTask, TaskStatus, TaskType } from '../database/schemas/delivery-task.schema';
import { Order } from '../database/schemas/order.schema';
import {
  OrderProof,
  ProofType,
  HandoverMethod,
  ProofReviewStatus,
} from '../database/schemas/order-proof.schema';
import { OrderStatusEvent } from '../database/schemas/order-status-event.schema';
import { DatabaseService } from '../database/database.service';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { OrderStateMachineService } from '../orders/order-state-machine.service';
import { OrderStatus, OrderActorRole } from '../orders/order-status.enum';
import { StorageService } from '../storage/storage.service';
import { ImageValidationService } from '../storage/image-validation.service';

describe('AgentTasksService — Proof of Pickup & Delivery Verification Engine', () => {
  let service: AgentTasksService;
  let mockDeliveryTaskModel: any;
  let mockOrderModel: any;
  let mockOrderProofModel: any;
  let mockOrderStatusEventModel: any;
  let mockDatabaseService: any;
  let mockOutboxPublisher: any;
  let mockStorageService: any;
  let mockImageValidationService: any;

  const agentId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678901');
  const otherAgentId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678902');
  const orderObjectId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678910');
  const taskObjectId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678920');

  const mockAgentUser = {
    _id: agentId,
    name: 'Vikram Singh',
    phone: '+919876543210',
    role: OrderActorRole.AGENT,
  } as any;

  const sampleDeliveryTask = {
    _id: taskObjectId,
    taskId: 'TSK_D_402736',
    orderId: 'TC402736',
    orderRef: orderObjectId,
    agentId: agentId,
    taskType: TaskType.DELIVERY,
    status: TaskStatus.ASSIGNED,
    scheduledDate: '2026-11-01',
    scheduledTimeWindow: '13:00 - 16:00',
    proofId: undefined as any,
    failureReason: undefined as any,
    failureNotes: undefined as any,
    failurePhotoKey: undefined as any,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  } as any;

  const samplePickupTask = {
    _id: new Types.ObjectId('66fa3b5b1a2c3d4e5f678921'),
    taskId: 'TSK_P_402736',
    orderId: 'TC402736',
    orderRef: orderObjectId,
    agentId: agentId,
    taskType: TaskType.PICKUP,
    status: TaskStatus.ASSIGNED,
    scheduledDate: '2026-11-01',
    scheduledTimeWindow: '09:00 - 12:00',
    proofId: undefined as any,
    failureReason: undefined as any,
    failureNotes: undefined as any,
    failurePhotoKey: undefined as any,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  } as any;

  const sampleOutForDeliveryOrder = {
    _id: orderObjectId,
    orderId: 'TC402736',
    status: OrderStatus.OUT_FOR_DELIVERY,
    deliveryProofId: undefined,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  const samplePickupScheduledOrder = {
    _id: orderObjectId,
    orderId: 'TC402736',
    status: OrderStatus.PICKUP_SCHEDULED,
    pickupProofId: undefined,
    save: jest.fn().mockImplementation(function () {
      return Promise.resolve(this);
    }),
  };

  beforeEach(async () => {
    const mockSession = {
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

    mockDeliveryTaskModel = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockOrderModel = {
      findOne: jest.fn(),
      find: jest.fn(),
    };

    mockOrderProofModel = {
      create: jest.fn().mockImplementation((docs) => {
        return Promise.resolve(
          docs.map((d: any) => ({
            ...d,
            _id: new Types.ObjectId('66fa3b5b1a2c3d4e5f678930'),
          })),
        );
      }),
      findById: jest.fn(),
    };

    mockOrderStatusEventModel = {
      create: jest.fn().mockImplementation((docs) => {
        return Promise.resolve(
          docs.map((d: any) => ({
            ...d,
            _id: new Types.ObjectId('66fa3b5b1a2c3d4e5f678940'),
          })),
        );
      }),
    };

    mockOutboxPublisher = {
      publish: jest.fn().mockResolvedValue({ _id: 'outbox_msg_123' }),
    };

    mockStorageService = {
      uploadFile: jest.fn().mockResolvedValue({
        key: 'proofs/TSK_D_402736_mock.jpeg',
        bucket: 'the-dry-clean-proofs',
      }),
      getSignedDownloadUrl: jest.fn().mockImplementation(async (key: string) => {
        return `https://s3.ap-south-1.amazonaws.com/the-dry-clean-proofs/${key}?signed=true`;
      }),
    };

    mockImageValidationService = {
      validateAndSanitize: jest.fn().mockResolvedValue({
        buffer: Buffer.from('sanitized-image'),
        format: 'jpeg',
        mimeType: 'image/jpeg',
        width: 1200,
        height: 900,
        originalSize: 45000,
        sanitizedSize: 38000,
        hasExifStripped: true,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentTasksService,
        OrderStateMachineService,
        {
          provide: getModelToken(DeliveryTask.name),
          useValue: mockDeliveryTaskModel,
        },
        {
          provide: getModelToken(Order.name),
          useValue: mockOrderModel,
        },
        {
          provide: getModelToken(OrderProof.name),
          useValue: mockOrderProofModel,
        },
        {
          provide: getModelToken(OrderStatusEvent.name),
          useValue: mockOrderStatusEventModel,
        },
        {
          provide: DatabaseService,
          useValue: mockDatabaseService,
        },
        {
          provide: OutboxPublisherService,
          useValue: mockOutboxPublisher,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: ImageValidationService,
          useValue: mockImageValidationService,
        },
      ],
    }).compile();

    service = module.get<AgentTasksService>(AgentTasksService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('submitProof() — Mandatory Proof Validation & DOD Verification', () => {
    it('1) delivery without photo is rejected with 400 Bad Request', async () => {
      // Setup task and order
      mockDeliveryTaskModel.findOne.mockResolvedValue({ ...sampleDeliveryTask });
      mockOrderModel.findOne.mockResolvedValue({ ...sampleOutForDeliveryOrder });

      // Call submitProof with 0 photos (no files and no photoKeys in dto)
      await expect(service.submitProof('TSK_D_402736', mockAgentUser, [], {})).rejects.toThrow(
        BadRequestException,
      );

      await expect(service.submitProof('TSK_D_402736', mockAgentUser, [], {})).rejects.toThrow(
        'MANDATORY_PROOF_PHOTO: At least 1 proof photo is required',
      );

      // Verify no proof was created
      expect(mockOrderProofModel.create).not.toHaveBeenCalled();
      expect(mockOrderStatusEventModel.create).not.toHaveBeenCalled();
      expect(mockOutboxPublisher.publish).not.toHaveBeenCalled();
    });

    it('2) unassigned agent is rejected with 403 Forbidden', async () => {
      // Task is assigned to `otherAgentId`, but `mockAgentUser` is calling
      const taskAssignedToOther = {
        ...sampleDeliveryTask,
        agentId: otherAgentId,
      };

      mockDeliveryTaskModel.findOne.mockResolvedValue(taskAssignedToOther);

      const fakeFile = {
        buffer: Buffer.from('mock-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'package.jpg',
        size: 5000,
      };

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow('UNASSIGNED_AGENT');

      expect(mockOrderProofModel.create).not.toHaveBeenCalled();
      expect(mockOrderStatusEventModel.create).not.toHaveBeenCalled();
    });

    it('3) valid proof transitions order to DELIVERED and creates OrderStatusEvent', async () => {
      const task = { ...sampleDeliveryTask };
      const order = { ...sampleOutForDeliveryOrder };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(order);

      const fakeFile = {
        buffer: Buffer.from('mock-pod-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'doorstep_delivery.jpg',
        size: 45000,
      };

      const result = await service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {
        handoverMethod: HandoverMethod.HANDED_TO_CUSTOMER,
        note: 'Customer Rahul Sharma verified and accepted garments.',
        latitude: 19.076,
        longitude: 72.8777,
        accuracy: 3.5,
      });

      // Verify result structure
      expect(result.success).toBe(true);
      expect(result.status).toBe(OrderStatus.DELIVERED);
      expect(result.type).toBe(ProofType.DELIVERY);
      expect(result.taskId).toBe('TSK_D_402736');
      expect(result.orderId).toBe('TC402736');
      expect(result.photoKeys.length).toBe(1);
      expect(result.signedUrls.length).toBe(1);
      expect(result.signedUrls[0]).toContain('the-dry-clean-proofs');

      // Verify ImageValidation and StorageService were invoked
      expect(mockImageValidationService.validateAndSanitize).toHaveBeenCalledWith(fakeFile);
      expect(mockStorageService.uploadFile).toHaveBeenCalled();

      // Verify Database Transaction:
      // 1. OrderProof created
      expect(mockOrderProofModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            orderId: 'TC402736',
            taskId: 'TSK_D_402736',
            type: ProofType.DELIVERY,
            agentId: agentId,
            handoverMethod: HandoverMethod.HANDED_TO_CUSTOMER,
            note: 'Customer Rahul Sharma verified and accepted garments.',
            reviewStatus: ProofReviewStatus.PENDING,
          }),
        ],
        expect.anything(),
      );

      // 2. Task status set to COMPLETED and proofId linked
      expect(task.status).toBe(TaskStatus.COMPLETED);
      expect(task.proofId).toBeDefined();
      expect(task.save).toHaveBeenCalled();

      // 3. Order status updated to DELIVERED and deliveryProofId linked
      expect(order.status).toBe(OrderStatus.DELIVERED);
      expect(order.deliveryProofId).toBeDefined();
      expect(order.save).toHaveBeenCalled();

      // 4. OrderStatusEvent audit trail created
      expect(mockOrderStatusEventModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            orderId: 'TC402736',
            previousStatus: OrderStatus.OUT_FOR_DELIVERY,
            status: OrderStatus.DELIVERED,
            updatedBy: {
              actorRole: OrderActorRole.AGENT,
              actorId: agentId.toString(),
            },
            proofId: expect.any(String),
          }),
        ],
        expect.anything(),
      );

      // 5. Outbox domain event published
      expect(mockOutboxPublisher.publish).toHaveBeenCalledWith(
        'ORDER_STATUS_CHANGED',
        expect.objectContaining({
          orderId: 'TC402736',
          status: OrderStatus.DELIVERED,
          previousStatus: OrderStatus.OUT_FOR_DELIVERY,
          updatedBy: {
            actorRole: OrderActorRole.AGENT,
            actorId: agentId.toString(),
          },
        }),
        expect.anything(),
      );
    });

    it('4) valid proof for pickup transitions order to PICKED_UP and sets pickupProofId', async () => {
      const task = { ...samplePickupTask };
      const order = { ...samplePickupScheduledOrder };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(order);

      const fakeFile = {
        buffer: Buffer.from('mock-pop-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'valet_pickup.jpg',
        size: 32000,
      };

      const result = await service.submitProof('TSK_P_402736', mockAgentUser, [fakeFile], {
        handoverMethod: HandoverMethod.HANDED_TO_CUSTOMER,
        note: 'Collected 3 garments in branded valet garment bag.',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe(OrderStatus.PICKED_UP);
      expect(result.type).toBe(ProofType.PICKUP);

      expect(task.status).toBe(TaskStatus.COMPLETED);
      expect(order.status).toBe(OrderStatus.PICKED_UP);
      expect(order.pickupProofId).toBeDefined();

      expect(mockOrderStatusEventModel.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            orderId: 'TC402736',
            previousStatus: OrderStatus.PICKUP_SCHEDULED,
            status: OrderStatus.PICKED_UP,
            updatedBy: {
              actorRole: OrderActorRole.AGENT,
              actorId: agentId.toString(),
            },
          }),
        ],
        expect.anything(),
      );
    });

    it('5) delivery proof is rejected if order is not in OUT_FOR_DELIVERY status', async () => {
      const task = { ...sampleDeliveryTask };
      const invalidOrder = {
        ...sampleOutForDeliveryOrder,
        status: OrderStatus.CONFIRMED, // Invalid state for delivery!
      };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(invalidOrder);

      const fakeFile = {
        buffer: Buffer.from('mock-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'package.jpg',
        size: 5000,
      };

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow('INVALID_ORDER_STATE');
    });

    it('6) pickup proof is rejected if order is not in PICKUP_SCHEDULED status', async () => {
      const task = { ...samplePickupTask };
      const invalidOrder = {
        ...samplePickupScheduledOrder,
        status: OrderStatus.DRAFT, // Invalid state for pickup!
      };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(invalidOrder);

      const fakeFile = {
        buffer: Buffer.from('mock-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'pickup.jpg',
        size: 5000,
      };

      await expect(
        service.submitProof('TSK_P_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitProof('TSK_P_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow('INVALID_ORDER_STATE');
    });

    it('7) throws NotFoundException if task does not exist', async () => {
      mockDeliveryTaskModel.findOne.mockResolvedValue(null);

      const fakeFile = {
        buffer: Buffer.from('mock-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'pickup.jpg',
        size: 5000,
      };

      await expect(
        service.submitProof('NON_EXISTENT_TASK', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('8) throws BadRequestException if task is already completed', async () => {
      const completedTask = {
        ...sampleDeliveryTask,
        status: TaskStatus.COMPLETED,
      };

      mockDeliveryTaskModel.findOne.mockResolvedValue(completedTask);

      const fakeFile = {
        buffer: Buffer.from('mock-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'pickup.jpg',
        size: 5000,
      };

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow('TASK_ALREADY_COMPLETED');
    });

    it('9) throws ConflictException on duplicate proof submission (unique index collision)', async () => {
      mockDeliveryTaskModel.findOne.mockResolvedValue({ ...sampleDeliveryTask });
      mockOrderModel.findOne.mockResolvedValue({ ...sampleOutForDeliveryOrder });

      mockDatabaseService.withTransaction.mockRejectedValue({
        code: 11000,
        message: 'E11000 duplicate key error collection: order_proofs index: taskId_1 dup key',
      });

      const fakeFile = {
        buffer: Buffer.from('mock-jpeg'),
        mimetype: 'image/jpeg',
        originalname: 'package.jpg',
        size: 5000,
      };

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow(ConflictException);

      await expect(
        service.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], {}),
      ).rejects.toThrow('DUPLICATE_PROOF');
    });
  });

  describe('getProofById()', () => {
    it('retrieves proof record and generates signed URLs', async () => {
      const proofId = new Types.ObjectId('66fa3b5b1a2c3d4e5f678930');
      const mockProofDoc = {
        _id: proofId,
        orderId: 'TC402736',
        taskId: 'TSK_D_402736',
        photoKeys: ['proofs/photo_1.jpeg', 'proofs/photo_2.jpeg'],
        toObject: () => ({
          _id: proofId,
          orderId: 'TC402736',
          taskId: 'TSK_D_402736',
          photoKeys: ['proofs/photo_1.jpeg', 'proofs/photo_2.jpeg'],
        }),
      };

      mockOrderProofModel.findById.mockResolvedValue(mockProofDoc);

      const result = await service.getProofById(proofId.toString());

      expect(result._id).toBe(proofId);
      expect(result.signedUrls.length).toBe(2);
      expect(mockStorageService.getSignedDownloadUrl).toHaveBeenCalledTimes(2);
    });

    it('throws BadRequestException for invalid ObjectId string', async () => {
      await expect(service.getProofById('invalid-mongo-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException if proof is not found', async () => {
      mockOrderProofModel.findById.mockResolvedValue(null);
      const validId = new Types.ObjectId().toString();

      await expect(service.getProofById(validId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('recordFailedAttempt()', () => {
    it('records failed pickup attempt successfully and transitions order to PICKUP_FAILED', async () => {
      const task = {
        ...samplePickupTask,
        status: TaskStatus.ASSIGNED,
        save: jest.fn().mockResolvedValue(true),
      };
      const order = {
        ...samplePickupScheduledOrder,
        status: OrderStatus.PICKUP_SCHEDULED,
        save: jest.fn().mockResolvedValue(true),
      };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(order);

      const dto = {
        reason: 'CUSTOMER_UNAVAILABLE',
        notes: 'Doorbell rang 3 times, phone switched off.',
        latitude: 19.076,
        longitude: 72.8777,
      };

      const result = await service.recordFailedAttempt(
        'TSK_P_402736',
        mockAgentUser,
        undefined,
        dto,
      );

      expect(result.success).toBe(true);
      expect(result.taskId).toBe('TSK_P_402736');
      expect(result.orderId).toBe('TC402736');
      expect(result.taskStatus).toBe(TaskStatus.FAILED);
      expect(result.orderStatus).toBe(OrderStatus.PICKUP_FAILED);
      expect(result.reason).toBe('CUSTOMER_UNAVAILABLE');
      expect(result.notes).toBe('Doorbell rang 3 times, phone switched off.');

      expect(task.status).toBe(TaskStatus.FAILED);
      expect(task.failureReason).toBe('CUSTOMER_UNAVAILABLE');
      expect(task.failureNotes).toBe('Doorbell rang 3 times, phone switched off.');
      expect(order.status).toBe(OrderStatus.PICKUP_FAILED);

      expect(mockOrderStatusEventModel.create).toHaveBeenCalled();
      expect(mockOutboxPublisher.publish).toHaveBeenCalledWith(
        'ORDER_STATUS_CHANGED',
        expect.objectContaining({
          orderId: 'TC402736',
          previousStatus: OrderStatus.PICKUP_SCHEDULED,
          status: OrderStatus.PICKUP_FAILED,
          reason: 'CUSTOMER_UNAVAILABLE',
        }),
        expect.anything(),
      );
    });

    it('records failed delivery attempt successfully and transitions order to DELIVERY_FAILED', async () => {
      const task = {
        ...sampleDeliveryTask,
        status: TaskStatus.ASSIGNED,
        save: jest.fn().mockResolvedValue(true),
      };
      const order = {
        ...sampleOutForDeliveryOrder,
        status: OrderStatus.OUT_FOR_DELIVERY,
        save: jest.fn().mockResolvedValue(true),
      };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(order);

      const dto = {
        reason: 'GATE_LOCKED',
        notes: 'Society security did not allow entry without resident pass.',
      };

      const result = await service.recordFailedAttempt(
        'TSK_D_402736',
        mockAgentUser,
        undefined,
        dto,
      );

      expect(result.success).toBe(true);
      expect(result.taskStatus).toBe(TaskStatus.FAILED);
      expect(result.orderStatus).toBe(OrderStatus.DELIVERY_FAILED);
      expect(result.reason).toBe('GATE_LOCKED');

      expect(task.status).toBe(TaskStatus.FAILED);
      expect(order.status).toBe(OrderStatus.DELIVERY_FAILED);
    });

    it('uploads optional photo evidence and generates signed preview URL', async () => {
      const task = {
        ...samplePickupTask,
        status: TaskStatus.ASSIGNED,
        save: jest.fn().mockResolvedValue(true),
      };
      const order = {
        ...samplePickupScheduledOrder,
        status: OrderStatus.PICKUP_SCHEDULED,
        save: jest.fn().mockResolvedValue(true),
      };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(order);

      const fakeFile = {
        buffer: Buffer.from('mock-locked-gate'),
        mimetype: 'image/jpeg',
        originalname: 'locked_gate.jpg',
        size: 4000,
      };

      const dto = {
        reason: 'GATE_LOCKED',
        notes: 'Main gate padlock is on.',
      };

      const result = await service.recordFailedAttempt(
        'TSK_P_402736',
        mockAgentUser,
        fakeFile as any,
        dto,
      );

      expect(result.success).toBe(true);
      expect(result.photoKey).toMatch(/^failed-attempts\/TSK_P_402736_/);
      expect(result.signedPhotoUrl).toBe(
        `https://s3.ap-south-1.amazonaws.com/the-dry-clean-proofs/${result.photoKey}?signed=true`,
      );
      expect(mockImageValidationService.validateAndSanitize).toHaveBeenCalledWith(fakeFile);
      expect(mockStorageService.uploadFile).toHaveBeenCalled();
      expect(task.failurePhotoKey).toBe(result.photoKey);
    });

    it('rejects with ForbiddenException when agent is not assigned to the task', async () => {
      const unassignedAgent = {
        _id: otherAgentId,
        name: 'Rahul Verma',
        role: OrderActorRole.AGENT,
      } as any;

      mockDeliveryTaskModel.findOne.mockResolvedValue(sampleDeliveryTask);

      await expect(
        service.recordFailedAttempt('TSK_D_402736', unassignedAgent, undefined, {
          reason: 'CUSTOMER_UNAVAILABLE',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects with NotFoundException when delivery task is not found', async () => {
      mockDeliveryTaskModel.findOne.mockResolvedValue(null);

      await expect(
        service.recordFailedAttempt('NON_EXISTENT_TASK', mockAgentUser, undefined, {
          reason: 'CUSTOMER_UNAVAILABLE',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with NotFoundException when associated order is not found', async () => {
      mockDeliveryTaskModel.findOne.mockResolvedValue(sampleDeliveryTask);
      mockOrderModel.findOne.mockResolvedValue(null);

      await expect(
        service.recordFailedAttempt('TSK_D_402736', mockAgentUser, undefined, {
          reason: 'CUSTOMER_UNAVAILABLE',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with BadRequestException when task is already COMPLETED', async () => {
      const completedTask = {
        ...sampleDeliveryTask,
        status: TaskStatus.COMPLETED,
      };
      mockDeliveryTaskModel.findOne.mockResolvedValue(completedTask);

      await expect(
        service.recordFailedAttempt('TSK_D_402736', mockAgentUser, undefined, {
          reason: 'CUSTOMER_UNAVAILABLE',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with BadRequestException when pickup order is not in PICKUP_SCHEDULED status', async () => {
      const task = { ...samplePickupTask, status: TaskStatus.ASSIGNED };
      const invalidOrder = { ...samplePickupScheduledOrder, status: OrderStatus.CONFIRMED };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(invalidOrder);

      await expect(
        service.recordFailedAttempt('TSK_P_402736', mockAgentUser, undefined, {
          reason: 'CUSTOMER_UNAVAILABLE',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects with BadRequestException when delivery order is not in OUT_FOR_DELIVERY status', async () => {
      const task = { ...sampleDeliveryTask, status: TaskStatus.ASSIGNED };
      const invalidOrder = { ...sampleOutForDeliveryOrder, status: OrderStatus.READY_FOR_DELIVERY };

      mockDeliveryTaskModel.findOne.mockResolvedValue(task);
      mockOrderModel.findOne.mockResolvedValue(invalidOrder);

      await expect(
        service.recordFailedAttempt('TSK_D_402736', mockAgentUser, undefined, {
          reason: 'CUSTOMER_UNAVAILABLE',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getAgentTasks()', () => {
    it('retrieves and enriches tasks assigned to the agent partitioned by today', async () => {
      const mockTasks = [
        {
          _id: taskObjectId,
          taskId: 'TSK_P_402736',
          orderId: 'TC402736',
          taskType: TaskType.PICKUP,
          status: TaskStatus.ASSIGNED,
          scheduledDate: '2026-11-01',
          scheduledTimeWindow: '09:00 - 12:00',
          attemptNumber: 1,
        },
      ];

      const mockOrders = [
        {
          orderId: 'TC402736',
          status: OrderStatus.PICKUP_SCHEDULED,
          addressSnapshot: {
            name: 'Aarav Mehta',
            contactPhone: '+91 98765 43210',
            street: 'Altamount Road 42',
            city: 'Mumbai',
            pincode: '400026',
          },
          items: [{ name: 'Silk Shirt' }],
        },
      ];

      mockDeliveryTaskModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(mockTasks),
        }),
      });

      mockOrderModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue(mockOrders),
      });

      const result = await service.getAgentTasks(mockAgentUser, { partition: 'today' });

      expect(result.length).toBe(1);
      expect(result[0].taskId).toBe('TSK_P_402736');
      expect(result[0].customer.name).toBe('Aarav Mehta');
      expect(result[0].customer.phone).toBe('+91 98765 43210');
      expect(result[0].orderStatus).toBe(OrderStatus.PICKUP_SCHEDULED);
      expect(mockDeliveryTaskModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: agentId,
          status: { $in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] },
        }),
      );
    });

    it('retrieves completed/failed tasks for completed partition', async () => {
      mockDeliveryTaskModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      mockOrderModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getAgentTasks(mockAgentUser, { partition: 'completed' });

      expect(result).toEqual([]);
      expect(mockDeliveryTaskModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          agentId: agentId,
          status: { $in: [TaskStatus.COMPLETED, TaskStatus.FAILED] },
        }),
      );
    });
  });
});
