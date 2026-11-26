import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AgentTasksController } from './agent-tasks.controller';
import { AgentTasksService } from './agent-tasks.service';
import { HandoverMethod } from '../database/schemas/order-proof.schema';
import { OrderStatus, OrderActorRole } from '../orders/order-status.enum';

describe('AgentTasksController', () => {
  let controller: AgentTasksController;
  let mockAgentTasksService: any;

  const mockAgentUser = {
    _id: new Types.ObjectId('66fa3b5b1a2c3d4e5f678901'),
    name: 'Vikram Singh',
    role: OrderActorRole.AGENT,
  } as any;

  beforeEach(async () => {
    mockAgentTasksService = {
      submitProof: jest.fn(),
      getProofById: jest.fn(),
      recordFailedAttempt: jest.fn(),
      getAgentTasks: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentTasksController],
      providers: [
        {
          provide: AgentTasksService,
          useValue: mockAgentTasksService,
        },
      ],
    }).compile();

    controller = module.get<AgentTasksController>(AgentTasksController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('POST :id/proof', () => {
    it('delegates proof submission to AgentTasksService with user, files, and dto', async () => {
      const mockResult = {
        success: true,
        proofId: '66fa3b5b1a2c3d4e5f678930',
        taskId: 'TSK_D_402736',
        orderId: 'TC402736',
        type: 'DELIVERY',
        status: OrderStatus.DELIVERED,
        photoKeys: ['proofs/photo_1.jpeg'],
        signedUrls: [
          'https://s3.ap-south-1.amazonaws.com/the-dry-clean-proofs/proofs/photo_1.jpeg',
        ],
        handoverMethod: HandoverMethod.HANDED_TO_CUSTOMER,
        capturedAt: new Date(),
        receivedAt: new Date(),
        reviewStatus: 'PENDING',
      };

      mockAgentTasksService.submitProof.mockResolvedValue(mockResult);

      const fakeFile = {
        buffer: Buffer.from('mock-bytes'),
        mimetype: 'image/jpeg',
        originalname: 'proof.jpg',
      } as any;

      const dto = {
        handoverMethod: HandoverMethod.HANDED_TO_CUSTOMER,
        note: 'Garments delivered safely.',
      };

      const result = await controller.submitProof('TSK_D_402736', mockAgentUser, [fakeFile], dto);

      expect(result).toEqual(mockResult);
      expect(mockAgentTasksService.submitProof).toHaveBeenCalledWith(
        'TSK_D_402736',
        mockAgentUser,
        [fakeFile],
        dto,
      );
    });

    it('passes empty array for files when none uploaded', async () => {
      mockAgentTasksService.submitProof.mockResolvedValue({ success: true });

      await controller.submitProof('TSK_D_402736', mockAgentUser, null as any, {});

      expect(mockAgentTasksService.submitProof).toHaveBeenCalledWith(
        'TSK_D_402736',
        mockAgentUser,
        [],
        {},
      );
    });
  });

  describe('GET proofs/:proofId', () => {
    it('delegates proof lookup to AgentTasksService', async () => {
      const mockProof = {
        _id: '66fa3b5b1a2c3d4e5f678930',
        orderId: 'TC402736',
        signedUrls: ['https://example.com/photo.jpeg'],
      };

      mockAgentTasksService.getProofById.mockResolvedValue(mockProof);

      const result = await controller.getProofById('66fa3b5b1a2c3d4e5f678930');

      expect(result).toEqual(mockProof);
      expect(mockAgentTasksService.getProofById).toHaveBeenCalledWith('66fa3b5b1a2c3d4e5f678930');
    });
  });

  describe('POST :id/failed-attempt', () => {
    it('delegates failed attempt recording to AgentTasksService with user, file, and dto', async () => {
      const mockResult = {
        success: true,
        taskId: 'TSK_P_402736',
        orderId: 'TC402736',
        taskType: 'PICKUP',
        taskStatus: 'FAILED',
        orderStatus: 'PICKUP_FAILED',
        reason: 'CUSTOMER_UNAVAILABLE',
        notes: 'Doorbell rang 3 times, phone switched off.',
        photoKey: 'failed-attempts/photo_1.jpeg',
        signedPhotoUrl:
          'https://s3.ap-south-1.amazonaws.com/the-dry-clean-proofs/failed-attempts/photo_1.jpeg',
        timestamp: new Date(),
      };

      mockAgentTasksService.recordFailedAttempt.mockResolvedValue(mockResult);

      const fakeFile = {
        buffer: Buffer.from('mock-bytes'),
        mimetype: 'image/jpeg',
        originalname: 'door.jpg',
      } as any;

      const dto = {
        reason: 'CUSTOMER_UNAVAILABLE',
        notes: 'Doorbell rang 3 times, phone switched off.',
      };

      const result = await controller.recordFailedAttempt(
        'TSK_P_402736',
        mockAgentUser,
        fakeFile,
        dto,
      );

      expect(result).toEqual(mockResult);
      expect(mockAgentTasksService.recordFailedAttempt).toHaveBeenCalledWith(
        'TSK_P_402736',
        mockAgentUser,
        fakeFile,
        dto,
      );
    });

    it('handles recording without file (undefined file)', async () => {
      mockAgentTasksService.recordFailedAttempt.mockResolvedValue({ success: true });

      const dto = {
        reason: 'GATE_LOCKED',
      };

      await controller.recordFailedAttempt('TSK_D_402736', mockAgentUser, undefined, dto);

      expect(mockAgentTasksService.recordFailedAttempt).toHaveBeenCalledWith(
        'TSK_D_402736',
        mockAgentUser,
        undefined,
        dto,
      );
    });
  });

  describe('GET /agent/tasks', () => {
    it('delegates task retrieval to AgentTasksService with user and query filters', async () => {
      const mockTasks = [
        {
          taskId: 'TSK_P_402736',
          orderId: 'TC402736',
          taskType: 'PICKUP',
          status: 'ASSIGNED',
          customer: { name: 'Aarav Mehta' },
        },
      ];

      mockAgentTasksService.getAgentTasks.mockResolvedValue(mockTasks);

      const result = await controller.getAgentTasks(
        mockAgentUser,
        'today',
        undefined,
        '2026-11-01',
      );

      expect(result).toEqual(mockTasks);
      expect(mockAgentTasksService.getAgentTasks).toHaveBeenCalledWith(mockAgentUser, {
        partition: 'today',
        status: undefined,
        date: '2026-11-01',
      });
    });
  });
});
