import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderStatus, OrderActorRole } from './order-status.enum';

describe('OrderStateMachineService', () => {
  let service: OrderStateMachineService;

  beforeEach(() => {
    service = new OrderStateMachineService();
  });

  describe('Valid Order Lifecycle Progression', () => {
    it('allows complete linear lifecycle from DRAFT to DELIVERED with valid proofs', () => {
      // 1. DRAFT -> PAYMENT_PENDING
      expect(() =>
        service.validateTransition(OrderStatus.DRAFT, OrderStatus.PAYMENT_PENDING, {
          actorRole: OrderActorRole.CUSTOMER,
          actorId: 'cust_1',
        }),
      ).not.toThrow();

      // 2. PAYMENT_PENDING -> CONFIRMED
      expect(() =>
        service.validateTransition(OrderStatus.PAYMENT_PENDING, OrderStatus.CONFIRMED, {
          actorRole: OrderActorRole.SYSTEM,
          actorId: 'sys_razorpay_webhook',
        }),
      ).not.toThrow();

      // 3. CONFIRMED -> PICKUP_SCHEDULED
      expect(() =>
        service.validateTransition(OrderStatus.CONFIRMED, OrderStatus.PICKUP_SCHEDULED, {
          actorRole: OrderActorRole.OPERATIONS,
          actorId: 'ops_1',
        }),
      ).not.toThrow();

      // 4. PICKUP_SCHEDULED -> PICKED_UP (with mandatory POP photo)
      expect(() =>
        service.validateTransition(OrderStatus.PICKUP_SCHEDULED, OrderStatus.PICKED_UP, {
          actorRole: OrderActorRole.AGENT,
          actorId: 'agent_1',
          proofId: 'proof_pop_123',
        }),
      ).not.toThrow();

      // 5. PICKED_UP -> RECEIVED_AT_FACILITY
      expect(() =>
        service.validateTransition(OrderStatus.PICKED_UP, OrderStatus.RECEIVED_AT_FACILITY, {
          actorRole: OrderActorRole.FACILITY_STAFF,
          actorId: 'staff_1',
        }),
      ).not.toThrow();

      // 6. RECEIVED_AT_FACILITY -> ASSESSMENT
      expect(() =>
        service.validateTransition(OrderStatus.RECEIVED_AT_FACILITY, OrderStatus.ASSESSMENT, {
          actorRole: OrderActorRole.FACILITY_STAFF,
          actorId: 'staff_1',
        }),
      ).not.toThrow();

      // 7. ASSESSMENT -> CLEANING_IN_PROGRESS
      expect(() =>
        service.validateTransition(OrderStatus.ASSESSMENT, OrderStatus.CLEANING_IN_PROGRESS, {
          actorRole: OrderActorRole.FACILITY_STAFF,
          actorId: 'staff_1',
        }),
      ).not.toThrow();

      // 8. CLEANING_IN_PROGRESS -> QUALITY_CHECK
      expect(() =>
        service.validateTransition(OrderStatus.CLEANING_IN_PROGRESS, OrderStatus.QUALITY_CHECK, {
          actorRole: OrderActorRole.QC_OPERATOR,
          actorId: 'qc_1',
        }),
      ).not.toThrow();

      // 9. QUALITY_CHECK -> READY_FOR_DELIVERY
      expect(() =>
        service.validateTransition(OrderStatus.QUALITY_CHECK, OrderStatus.READY_FOR_DELIVERY, {
          actorRole: OrderActorRole.QC_OPERATOR,
          actorId: 'qc_1',
        }),
      ).not.toThrow();

      // 10. READY_FOR_DELIVERY -> OUT_FOR_DELIVERY
      expect(() =>
        service.validateTransition(OrderStatus.READY_FOR_DELIVERY, OrderStatus.OUT_FOR_DELIVERY, {
          actorRole: OrderActorRole.OPERATIONS,
          actorId: 'ops_1',
        }),
      ).not.toThrow();

      // 11. OUT_FOR_DELIVERY -> DELIVERED (with mandatory POD photo)
      expect(() =>
        service.validateTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, {
          actorRole: OrderActorRole.AGENT,
          actorId: 'agent_2',
          proofId: 'proof_pod_456',
        }),
      ).not.toThrow();
    });

    it('supports Quality Check failure and rework loop', () => {
      // QC fails -> REWORK_REQUIRED
      expect(() =>
        service.validateTransition(OrderStatus.QUALITY_CHECK, OrderStatus.REWORK_REQUIRED, {
          actorRole: OrderActorRole.QC_OPERATOR,
          actorId: 'qc_1',
        }),
      ).not.toThrow();

      // REWORK_REQUIRED -> CLEANING_IN_PROGRESS
      expect(() =>
        service.validateTransition(OrderStatus.REWORK_REQUIRED, OrderStatus.CLEANING_IN_PROGRESS, {
          actorRole: OrderActorRole.FACILITY_STAFF,
          actorId: 'staff_1',
        }),
      ).not.toThrow();
    });

    it('supports Pickup failure and rescheduling loop', () => {
      // PICKUP_SCHEDULED -> PICKUP_FAILED
      expect(() =>
        service.validateTransition(OrderStatus.PICKUP_SCHEDULED, OrderStatus.PICKUP_FAILED, {
          actorRole: OrderActorRole.AGENT,
          actorId: 'agent_1',
          failureReason: 'Customer not reachable',
        }),
      ).not.toThrow();

      // PICKUP_FAILED -> RESCHEDULED
      expect(() =>
        service.validateTransition(OrderStatus.PICKUP_FAILED, OrderStatus.RESCHEDULED, {
          actorRole: OrderActorRole.CUSTOMER,
          actorId: 'cust_1',
        }),
      ).not.toThrow();

      // RESCHEDULED -> PICKUP_SCHEDULED
      expect(() =>
        service.validateTransition(OrderStatus.RESCHEDULED, OrderStatus.PICKUP_SCHEDULED, {
          actorRole: OrderActorRole.OPERATIONS,
          actorId: 'ops_1',
        }),
      ).not.toThrow();
    });
  });

  describe('Mandatory Proof Verification Enforcement', () => {
    it('throws BadRequestException when transitioning to PICKED_UP without proofId', () => {
      expect(() =>
        service.validateTransition(OrderStatus.PICKUP_SCHEDULED, OrderStatus.PICKED_UP, {
          actorRole: OrderActorRole.AGENT,
          actorId: 'agent_1',
        }),
      ).toThrow(BadRequestException);

      expect(() =>
        service.validateTransition(OrderStatus.PICKUP_SCHEDULED, OrderStatus.PICKED_UP, {
          actorRole: OrderActorRole.AGENT,
          actorId: 'agent_1',
          proofId: '   ',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException when transitioning to DELIVERED without proofId', () => {
      expect(() =>
        service.validateTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, {
          actorRole: OrderActorRole.AGENT,
          actorId: 'agent_1',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('Terminal States Protection', () => {
    it('blocks any further transition from DELIVERED', () => {
      expect(service.isTerminal(OrderStatus.DELIVERED)).toBe(true);

      expect(() =>
        service.validateTransition(OrderStatus.DELIVERED, OrderStatus.CLEANING_IN_PROGRESS, {
          actorRole: OrderActorRole.ADMIN,
          actorId: 'admin_1',
        }),
      ).toThrow(BadRequestException);
    });

    it('blocks any further transition from CANCELLED', () => {
      expect(service.isTerminal(OrderStatus.CANCELLED)).toBe(true);

      expect(() =>
        service.validateTransition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED, {
          actorRole: OrderActorRole.ADMIN,
          actorId: 'admin_1',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('Backward and Unauthorized Hops Protection', () => {
    it('blocks backward transition from QUALITY_CHECK to PICKED_UP', () => {
      expect(() =>
        service.validateTransition(OrderStatus.QUALITY_CHECK, OrderStatus.PICKED_UP, {
          actorRole: OrderActorRole.ADMIN,
          actorId: 'admin_1',
        }),
      ).toThrow(BadRequestException);
    });

    it('blocks jumping from CONFIRMED directly to DELIVERED', () => {
      expect(() =>
        service.validateTransition(OrderStatus.CONFIRMED, OrderStatus.DELIVERED, {
          actorRole: OrderActorRole.ADMIN,
          actorId: 'admin_1',
          proofId: 'proof_123',
        }),
      ).toThrow(BadRequestException);
    });

    it('throws BadRequestException on no-op same status transition', () => {
      expect(() =>
        service.validateTransition(OrderStatus.CONFIRMED, OrderStatus.CONFIRMED, {
          actorRole: OrderActorRole.ADMIN,
          actorId: 'admin_1',
        }),
      ).toThrow(BadRequestException);
    });
  });

  describe('Role-Based Access Control (RBAC)', () => {
    it('blocks customer from completing agent delivery handover', () => {
      expect(() =>
        service.validateTransition(OrderStatus.OUT_FOR_DELIVERY, OrderStatus.DELIVERED, {
          actorRole: OrderActorRole.CUSTOMER,
          actorId: 'cust_1',
          proofId: 'proof_123',
        }),
      ).toThrow(ForbiddenException);
    });

    it('blocks agent from cancelling order during facility assessment', () => {
      expect(() =>
        service.validateTransition(OrderStatus.ASSESSMENT, OrderStatus.CANCELLED, {
          actorRole: OrderActorRole.AGENT,
          actorId: 'agent_1',
        }),
      ).toThrow(ForbiddenException);
    });
  });

  describe('Utility & Query Methods', () => {
    it('returns customer-facing labels accurately', () => {
      expect(service.getCustomerFacingLabel(OrderStatus.CONFIRMED)).toBe('Booking Confirmed');
      expect(service.getCustomerFacingLabel(OrderStatus.PICKED_UP)).toBe('Picked Up');
      expect(service.getCustomerFacingLabel(OrderStatus.CLEANING_IN_PROGRESS)).toBe(
        'Cleaning in Progress',
      );
      expect(service.getCustomerFacingLabel(OrderStatus.DELIVERED)).toBe('Delivered');
    });

    it('identifies customer-visible statuses', () => {
      expect(service.isCustomerVisible(OrderStatus.CONFIRMED)).toBe(true);
      expect(service.isCustomerVisible(OrderStatus.DELIVERED)).toBe(true);
      expect(service.isCustomerVisible(OrderStatus.ASSESSMENT)).toBe(false);
      expect(service.isCustomerVisible(OrderStatus.REWORK_REQUIRED)).toBe(false);
    });

    it('returns permitted target states for a given role', () => {
      const agentAllowed = service.getAllowedTransitions(
        OrderStatus.PICKUP_SCHEDULED,
        OrderActorRole.AGENT,
      );
      expect(agentAllowed).toContain(OrderStatus.PICKED_UP);
      expect(agentAllowed).toContain(OrderStatus.PICKUP_FAILED);
      expect(agentAllowed).not.toContain(OrderStatus.CANCELLED);
    });
  });
});
