import { Test, TestingModule } from '@nestjs/testing';
import { AdminProofsController } from './admin-proofs.controller';
import { OrdersService } from './orders.service';
import { ProofReviewAction } from './dto/review-proof.dto';
import { OrderActorRole } from './order-status.enum';
import { UserDocument } from '../database/schemas/user.schema';

describe('AdminProofsController', () => {
  let controller: AdminProofsController;
  let ordersService: jest.Mocked<Partial<OrdersService>>;

  const mockAdminUser = {
    _id: 'usr_admin_001',
    name: 'Aditya Sharma',
    phone: '+919876543210',
    role: OrderActorRole.ADMIN,
  } as unknown as UserDocument;

  beforeEach(async () => {
    ordersService = {
      getAdminProofsReviewQueue: jest.fn(),
      reviewAdminProof: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminProofsController],
      providers: [{ provide: OrdersService, useValue: ordersService }],
    }).compile();

    controller = module.get<AdminProofsController>(AdminProofsController);
  });

  describe('getReviewQueue', () => {
    it('delegates to ordersService.getAdminProofsReviewQueue with query parameters', async () => {
      const mockResult = {
        proofs: [{ id: 'proof_123', orderId: 'TC402738' }] as any,
        total: 1,
        pendingCount: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      (ordersService.getAdminProofsReviewQueue as jest.Mock).mockResolvedValue(mockResult);

      const res = await controller.getReviewQueue('PENDING', 1, 20);

      expect(ordersService.getAdminProofsReviewQueue).toHaveBeenCalledWith('PENDING', 1, 20);
      expect(res).toEqual(mockResult);
    });
  });

  describe('reviewProof', () => {
    it('delegates review verification to ordersService.reviewAdminProof', async () => {
      const mockResult = {
        success: true,
        proof: {
          id: 'proof_123',
          orderId: 'TC402738',
          reviewStatus: 'VERIFIED',
          reviewedBy: mockAdminUser._id.toString(),
          reviewedAt: new Date().toISOString(),
        },
        ticket: null,
      } as any;
      (ordersService.reviewAdminProof as jest.Mock).mockResolvedValue(mockResult);

      const dto = { action: ProofReviewAction.VERIFIED };
      const res = await controller.reviewProof('proof_123', dto, mockAdminUser);

      expect(ordersService.reviewAdminProof).toHaveBeenCalledWith('proof_123', dto, mockAdminUser);
      expect(res).toEqual(mockResult);
    });

    it('delegates review flagging with reason to ordersService.reviewAdminProof', async () => {
      const mockResult = {
        success: true,
        proof: {
          id: 'proof_123',
          orderId: 'TC402738',
          reviewStatus: 'FLAGGED',
          reviewedBy: mockAdminUser._id.toString(),
          reviewedAt: new Date().toISOString(),
          flaggedReason: 'Photo is blurry',
        },
        ticket: {
          ticketNumber: 'TKT-FLG-TC402738-1234',
          status: 'OPEN',
          priority: 'HIGH',
        },
      } as any;
      (ordersService.reviewAdminProof as jest.Mock).mockResolvedValue(mockResult);

      const dto = { action: ProofReviewAction.FLAGGED, reason: 'Photo is blurry' };
      const res = await controller.reviewProof('proof_123', dto, mockAdminUser);

      expect(ordersService.reviewAdminProof).toHaveBeenCalledWith('proof_123', dto, mockAdminUser);
      expect(res).toEqual(mockResult);
    });
  });
});
