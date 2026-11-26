import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ReconciliationService } from './reconciliation.service';
import { Order } from '../database/schemas/order.schema';
import { OrderProof } from '../database/schemas/order-proof.schema';
import {
  SecurityAudit,
  SecurityAnomalyType,
  SecurityAnomalySeverity,
  SecurityAnomalyStatus,
} from '../database/schemas/security-audit.schema';
import { OrderStatus } from '../orders/order-status.enum';

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let mockOrderModel: any;
  let mockOrderProofModel: any;
  let mockSecurityAuditModel: any;

  const validProofId = new Types.ObjectId();
  const validOrderId = new Types.ObjectId();

  beforeEach(async () => {
    mockOrderModel = {
      find: jest.fn(),
    };

    mockOrderProofModel = {
      findOne: jest.fn(),
    };

    mockSecurityAuditModel = {
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((doc) =>
        Promise.resolve({
          _id: new Types.ObjectId(),
          ...doc,
          createdAt: new Date(),
        }),
      ),
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      }),
      findByIdAndUpdate: jest.fn().mockImplementation((id, update) =>
        Promise.resolve({
          _id: id,
          orderId: 'TC402738',
          ...update,
        }),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        {
          provide: getModelToken(Order.name),
          useValue: mockOrderModel,
        },
        {
          provide: getModelToken(OrderProof.name),
          useValue: mockOrderProofModel,
        },
        {
          provide: getModelToken(SecurityAudit.name),
          useValue: mockSecurityAuditModel,
        },
      ],
    }).compile();

    service = module.get<ReconciliationService>(ReconciliationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('reconcileProofInvariants', () => {
    it('returns zero breaches when all delivered and active orders have valid photo proofs', async () => {
      // 1 valid delivered order
      const mockDeliveredOrder = {
        _id: validOrderId,
        orderId: 'TC402738',
        status: OrderStatus.DELIVERED,
        pickupProofId: new Types.ObjectId(),
        deliveryProofId: validProofId,
      };

      // Mock queries: first call for DELIVERED, second call for post-pickup
      mockOrderModel.find
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([mockDeliveredOrder]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([mockDeliveredOrder]),
        });

      // Both proofs exist and have valid photos
      mockOrderProofModel.findOne.mockResolvedValue({
        _id: validProofId,
        photoKeys: ['proofs/TC402738/photo1.jpg'],
      });

      const report = await service.reconcileProofInvariants();

      expect(report.scannedOrders).toBe(2);
      expect(report.anomaliesFound).toBe(0);
      expect(report.newAnomaliesLogged).toBe(0);
      expect(mockSecurityAuditModel.create).not.toHaveBeenCalled();
    });

    it('detects breach when an order is marked DELIVERED without deliveryProofId (bypass invariant)', async () => {
      const breachedOrder = {
        _id: validOrderId,
        orderId: 'TC402799',
        status: OrderStatus.DELIVERED,
        pickupProofId: validProofId,
        // deliveryProofId missing!
      };

      mockOrderModel.find
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([breachedOrder]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([]),
        });

      mockSecurityAuditModel.findOne.mockResolvedValue(null); // No previous unresolved audit

      const report = await service.reconcileProofInvariants();

      expect(report.anomaliesFound).toBe(1);
      expect(report.newAnomaliesLogged).toBe(1);
      expect(report.breaches[0].anomalyType).toBe(SecurityAnomalyType.DELIVERY_WITHOUT_PROOF);
      expect(report.breaches[0].severity).toBe(SecurityAnomalySeverity.CRITICAL);
      expect(mockSecurityAuditModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'TC402799',
          anomalyType: SecurityAnomalyType.DELIVERY_WITHOUT_PROOF,
          severity: SecurityAnomalySeverity.CRITICAL,
          status: SecurityAnomalyStatus.UNRESOLVED,
        }),
      );
    });

    it('detects breach when order references non-existent deliveryProof document', async () => {
      const breachedOrder = {
        _id: validOrderId,
        orderId: 'TC402798',
        status: OrderStatus.DELIVERED,
        deliveryProofId: new Types.ObjectId(),
      };

      mockOrderModel.find
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([breachedOrder]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([]),
        });

      mockOrderProofModel.findOne.mockResolvedValue(null); // Proof doc doesn't exist!
      mockSecurityAuditModel.findOne.mockResolvedValue(null);

      const report = await service.reconcileProofInvariants();

      expect(report.anomaliesFound).toBe(1);
      expect(report.breaches[0].description).toContain('no matching DELIVERY proof exists');
    });

    it('detects breach when delivery proof has empty photoKeys array', async () => {
      const breachedOrder = {
        _id: validOrderId,
        orderId: 'TC402797',
        status: OrderStatus.DELIVERED,
        deliveryProofId: validProofId,
      };

      mockOrderModel.find
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([breachedOrder]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([]),
        });

      mockOrderProofModel.findOne.mockResolvedValue({
        _id: validProofId,
        photoKeys: [], // Empty! Mandatory photo violated
      });
      mockSecurityAuditModel.findOne.mockResolvedValue(null);

      const report = await service.reconcileProofInvariants();

      expect(report.anomaliesFound).toBe(1);
      expect(report.breaches[0].description).toContain('zero photoKeys recorded');
    });

    it('detects breach when order is CLEANING_IN_PROGRESS without valid pickup proof', async () => {
      const activeOrder = {
        _id: validOrderId,
        orderId: 'TC402796',
        status: OrderStatus.CLEANING_IN_PROGRESS,
        // pickupProofId missing!
      };

      mockOrderModel.find
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([activeOrder]),
        });

      mockSecurityAuditModel.findOne.mockResolvedValue(null);

      const report = await service.reconcileProofInvariants();

      expect(report.anomaliesFound).toBe(1);
      expect(report.breaches[0].anomalyType).toBe(SecurityAnomalyType.PICKUP_WITHOUT_PROOF);
      expect(report.breaches[0].severity).toBe(SecurityAnomalySeverity.CRITICAL);
    });

    it('does not re-log an anomaly if an unresolved record already exists', async () => {
      const breachedOrder = {
        _id: validOrderId,
        orderId: 'TC402795',
        status: OrderStatus.DELIVERED,
      };

      mockOrderModel.find
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([breachedOrder]),
        })
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue([]),
        });

      // Existing unresolved audit already in DB
      mockSecurityAuditModel.findOne.mockResolvedValue({
        _id: new Types.ObjectId(),
        status: SecurityAnomalyStatus.UNRESOLVED,
      });

      const report = await service.reconcileProofInvariants();

      expect(report.anomaliesFound).toBe(1);
      expect(report.newAnomaliesLogged).toBe(0); // Deduplicated!
      expect(mockSecurityAuditModel.create).not.toHaveBeenCalled();
    });
  });

  describe('resolveAnomaly', () => {
    it('marks anomaly as RESOLVED with audit note', async () => {
      const anomalyId = new Types.ObjectId().toString();
      const resolved = await service.resolveAnomaly(
        anomalyId,
        'user_admin_123',
        'Verified manually via concierge call with customer',
      );

      expect(mockSecurityAuditModel.findByIdAndUpdate).toHaveBeenCalledWith(
        anomalyId,
        expect.objectContaining({
          status: SecurityAnomalyStatus.RESOLVED,
          resolutionNote: 'Verified manually via concierge call with customer',
        }),
        { new: true },
      );
      expect(resolved).toBeDefined();
      expect(resolved?.orderId).toBe('TC402738');
    });
  });
});
