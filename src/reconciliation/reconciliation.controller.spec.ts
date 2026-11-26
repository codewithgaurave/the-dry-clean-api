import { Test, TestingModule } from '@nestjs/testing';
import { ReconciliationController } from './reconciliation.controller';
import { ReconciliationService } from './reconciliation.service';
import { Types } from 'mongoose';
import { SecurityAnomalyStatus } from '../database/schemas/security-audit.schema';

describe('ReconciliationController', () => {
  let controller: ReconciliationController;
  let mockService: any;

  const mockUser: any = {
    _id: new Types.ObjectId(),
    name: 'Admin Staff',
    role: 'ADMIN',
  };

  beforeEach(async () => {
    mockService = {
      reconcileProofInvariants: jest.fn().mockResolvedValue({
        scannedOrders: 10,
        anomaliesFound: 0,
        newAnomaliesLogged: 0,
        breaches: [],
        timestamp: new Date(),
      }),
      getAnomalies: jest.fn().mockResolvedValue([
        {
          id: 'anom_1',
          orderId: 'TC402738',
          anomalyType: 'DELIVERY_WITHOUT_PROOF',
          status: 'UNRESOLVED',
        },
      ]),
      resolveAnomaly: jest.fn().mockResolvedValue({
        id: 'anom_1',
        orderId: 'TC402738',
        status: 'RESOLVED',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReconciliationController],
      providers: [
        {
          provide: ReconciliationService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ReconciliationController>(ReconciliationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('triggerReconciliation', () => {
    it('executes reconciliation on demand', async () => {
      const report = await controller.triggerReconciliation();
      expect(mockService.reconcileProofInvariants).toHaveBeenCalled();
      expect(report.scannedOrders).toBe(10);
    });
  });

  describe('listAnomalies', () => {
    it('lists anomalies with optional status filter', async () => {
      const anomalies = await controller.listAnomalies(SecurityAnomalyStatus.UNRESOLVED);
      expect(mockService.getAnomalies).toHaveBeenCalledWith(SecurityAnomalyStatus.UNRESOLVED);
      expect(anomalies.length).toBe(1);
    });
  });

  describe('resolveAnomaly', () => {
    it('resolves an anomaly with resolution note and user ID', async () => {
      const result = await controller.resolveAnomaly(mockUser, 'anom_1', {
        resolutionNote: 'Reviewed physical receipt',
      });
      expect(mockService.resolveAnomaly).toHaveBeenCalledWith(
        'anom_1',
        mockUser._id.toString(),
        'Reviewed physical receipt',
      );
      expect(result).toBeDefined();
      expect(result?.status).toBe('RESOLVED');
    });
  });
});
