import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrderStatus, OrderActorRole } from './order-status.enum';

export interface TransitionContext {
  actorRole: OrderActorRole;
  actorId: string;
  proofId?: string;
  failureReason?: string;
  note?: string;
}

interface TransitionRule {
  target: OrderStatus;
  allowedRoles: OrderActorRole[];
  requiresProof?: boolean;
}

/**
 * Order State Machine Domain Engine.
 * Source of truth: PRD.md §8 (Lifecycle & Key Transitions), §6.12 (Mandatory Proof Rules), TECH_STACK.md §7.2.
 */
@Injectable()
export class OrderStateMachineService {
  /**
   * Terminal states: strictly immutable once reached.
   */
  private readonly terminalStates = new Set<OrderStatus>([
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ]);

  /**
   * Complete canonical transition rules graph.
   */
  private readonly transitionsMap: Record<OrderStatus, TransitionRule[]> = {
    [OrderStatus.DRAFT]: [
      {
        target: OrderStatus.PAYMENT_PENDING,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.SYSTEM],
      },
      {
        target: OrderStatus.CONFIRMED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.SYSTEM, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.ADMIN, OrderActorRole.SYSTEM],
      },
    ],

    [OrderStatus.PAYMENT_PENDING]: [
      {
        target: OrderStatus.CONFIRMED,
        allowedRoles: [OrderActorRole.SYSTEM, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.PAYMENT_FAILED,
        allowedRoles: [OrderActorRole.SYSTEM, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.ADMIN, OrderActorRole.SYSTEM],
      },
    ],

    [OrderStatus.PAYMENT_FAILED]: [
      {
        target: OrderStatus.PAYMENT_PENDING,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.SYSTEM],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.ADMIN, OrderActorRole.SYSTEM],
      },
    ],

    [OrderStatus.CONFIRMED]: [
      {
        target: OrderStatus.PICKUP_SCHEDULED,
        allowedRoles: [OrderActorRole.SYSTEM, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.RESCHEDULED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
    ],

    [OrderStatus.PICKUP_SCHEDULED]: [
      {
        target: OrderStatus.PICKED_UP,
        allowedRoles: [OrderActorRole.AGENT, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
        requiresProof: true, // Mandatory POP (Proof of Pickup) photo
      },
      {
        target: OrderStatus.PICKUP_FAILED,
        allowedRoles: [OrderActorRole.AGENT, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.RESCHEDULED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
    ],

    [OrderStatus.PICKUP_FAILED]: [
      {
        target: OrderStatus.RESCHEDULED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
    ],

    [OrderStatus.RESCHEDULED]: [
      {
        target: OrderStatus.PICKUP_SCHEDULED,
        allowedRoles: [OrderActorRole.OPERATIONS, OrderActorRole.ADMIN, OrderActorRole.SYSTEM],
      },
      {
        target: OrderStatus.OUT_FOR_DELIVERY,
        allowedRoles: [OrderActorRole.OPERATIONS, OrderActorRole.ADMIN, OrderActorRole.SYSTEM],
      },
      {
        target: OrderStatus.RESCHEDULED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
    ],

    [OrderStatus.PICKED_UP]: [
      {
        target: OrderStatus.RECEIVED_AT_FACILITY,
        allowedRoles: [
          OrderActorRole.FACILITY_STAFF,
          OrderActorRole.OPERATIONS,
          OrderActorRole.ADMIN,
        ],
      },
    ],

    [OrderStatus.RECEIVED_AT_FACILITY]: [
      {
        target: OrderStatus.ASSESSMENT,
        allowedRoles: [
          OrderActorRole.FACILITY_STAFF,
          OrderActorRole.OPERATIONS,
          OrderActorRole.ADMIN,
        ],
      },
      {
        target: OrderStatus.CLEANING_IN_PROGRESS,
        allowedRoles: [
          OrderActorRole.FACILITY_STAFF,
          OrderActorRole.OPERATIONS,
          OrderActorRole.ADMIN,
        ],
      },
    ],

    [OrderStatus.ASSESSMENT]: [
      {
        target: OrderStatus.CLEANING_IN_PROGRESS,
        allowedRoles: [
          OrderActorRole.FACILITY_STAFF,
          OrderActorRole.OPERATIONS,
          OrderActorRole.ADMIN,
        ],
      },
      {
        target: OrderStatus.CANCELLED,
        allowedRoles: [OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
    ],

    [OrderStatus.CLEANING_IN_PROGRESS]: [
      {
        target: OrderStatus.QUALITY_CHECK,
        allowedRoles: [
          OrderActorRole.FACILITY_STAFF,
          OrderActorRole.QC_OPERATOR,
          OrderActorRole.OPERATIONS,
          OrderActorRole.ADMIN,
        ],
      },
    ],

    [OrderStatus.QUALITY_CHECK]: [
      {
        target: OrderStatus.READY_FOR_DELIVERY,
        allowedRoles: [OrderActorRole.QC_OPERATOR, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.REWORK_REQUIRED,
        allowedRoles: [OrderActorRole.QC_OPERATOR, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
    ],

    [OrderStatus.REWORK_REQUIRED]: [
      {
        target: OrderStatus.CLEANING_IN_PROGRESS,
        allowedRoles: [
          OrderActorRole.FACILITY_STAFF,
          OrderActorRole.OPERATIONS,
          OrderActorRole.ADMIN,
        ],
      },
    ],

    [OrderStatus.READY_FOR_DELIVERY]: [
      {
        target: OrderStatus.OUT_FOR_DELIVERY,
        allowedRoles: [OrderActorRole.OPERATIONS, OrderActorRole.ADMIN, OrderActorRole.SYSTEM],
      },
    ],

    [OrderStatus.OUT_FOR_DELIVERY]: [
      {
        target: OrderStatus.DELIVERED,
        allowedRoles: [OrderActorRole.AGENT, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
        requiresProof: true, // Mandatory POD (Proof of Delivery) photo
      },
      {
        target: OrderStatus.DELIVERY_FAILED,
        allowedRoles: [OrderActorRole.AGENT, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
    ],

    [OrderStatus.DELIVERY_FAILED]: [
      {
        target: OrderStatus.RESCHEDULED,
        allowedRoles: [OrderActorRole.CUSTOMER, OrderActorRole.OPERATIONS, OrderActorRole.ADMIN],
      },
      {
        target: OrderStatus.OUT_FOR_DELIVERY,
        allowedRoles: [OrderActorRole.OPERATIONS, OrderActorRole.ADMIN, OrderActorRole.SYSTEM],
      },
    ],

    // Terminal states have empty target lists
    [OrderStatus.DELIVERED]: [],
    [OrderStatus.CANCELLED]: [],
  };

  /**
   * Customer-facing status labels (PRD.md §8.4).
   */
  private readonly customerLabels: Record<OrderStatus, string> = {
    [OrderStatus.DRAFT]: 'Draft Booking',
    [OrderStatus.PAYMENT_PENDING]: 'Payment Pending',
    [OrderStatus.PAYMENT_FAILED]: 'Payment Failed',
    [OrderStatus.CONFIRMED]: 'Booking Confirmed',
    [OrderStatus.PICKUP_SCHEDULED]: 'Pickup Scheduled',
    [OrderStatus.PICKED_UP]: 'Picked Up',
    [OrderStatus.PICKUP_FAILED]: 'Pickup Attempt Failed',
    [OrderStatus.RECEIVED_AT_FACILITY]: 'Received at Facility',
    [OrderStatus.ASSESSMENT]: 'Garment Assessment',
    [OrderStatus.CLEANING_IN_PROGRESS]: 'Cleaning in Progress',
    [OrderStatus.QUALITY_CHECK]: 'Quality Check',
    [OrderStatus.REWORK_REQUIRED]: 'Specialist Care & Rework',
    [OrderStatus.READY_FOR_DELIVERY]: 'Ready for Delivery',
    [OrderStatus.OUT_FOR_DELIVERY]: 'Out for Delivery',
    [OrderStatus.DELIVERED]: 'Delivered',
    [OrderStatus.DELIVERY_FAILED]: 'Delivery Attempt Failed',
    [OrderStatus.RESCHEDULED]: 'Rescheduled',
    [OrderStatus.CANCELLED]: 'Cancelled',
  };

  /**
   * Validates state transition strictly against lifecycle, terminal rules, role RBAC, and proof policies.
   */
  validateTransition(
    currentStatus: OrderStatus,
    targetStatus: OrderStatus,
    context: TransitionContext,
  ): void {
    // 1. Guard against no-op transitions
    if (currentStatus === targetStatus) {
      throw new BadRequestException(
        `NOOP_TRANSITION: Order is already in status '${currentStatus}'.`,
      );
    }

    // 2. Guard against terminal states (Immutability rule)
    if (this.isTerminal(currentStatus)) {
      throw new BadRequestException(
        `TERMINAL_STATE: Order is in terminal state '${currentStatus}' and cannot transition.`,
      );
    }

    // 3. Look up allowed transitions from the state machine graph
    const validRules = this.transitionsMap[currentStatus] || [];
    const matchedRule = validRules.find((rule) => rule.target === targetStatus);

    if (!matchedRule) {
      throw new BadRequestException(
        `FORBIDDEN_TRANSITION: Invalid transition from '${currentStatus}' to '${targetStatus}'. Backward or unauthorized hops are blocked.`,
      );
    }

    // 4. Role Authorization check (RBAC)
    if (!matchedRule.allowedRoles.includes(context.actorRole)) {
      throw new ForbiddenException(
        `ROLE_NOT_AUTHORIZED: Actor with role '${context.actorRole}' is not authorized to transition order from '${currentStatus}' to '${targetStatus}'.`,
      );
    }

    // 5. Mandatory Proof Photo verification (PRD.md §6.12.1, §6.12.2)
    if (matchedRule.requiresProof) {
      if (!context.proofId || context.proofId.trim().length === 0) {
        throw new BadRequestException(
          `PROOF_REQUIRED: Transition from '${currentStatus}' to '${targetStatus}' mandates a verified proof photo reference (POP/POD).`,
        );
      }
    }
  }

  /**
   * Returns true if status is an immutable terminal state (DELIVERED or CANCELLED).
   */
  isTerminal(status: OrderStatus): boolean {
    return this.terminalStates.has(status);
  }

  /**
   * Get all permissible target states from current status (optionally filtered by actor role).
   */
  getAllowedTransitions(currentStatus: OrderStatus, actorRole?: OrderActorRole): OrderStatus[] {
    const rules = this.transitionsMap[currentStatus] || [];
    if (!actorRole) {
      return rules.map((r) => r.target);
    }
    return rules.filter((r) => r.allowedRoles.includes(actorRole)).map((r) => r.target);
  }

  /**
   * Get customer-facing friendly label.
   */
  getCustomerFacingLabel(status: OrderStatus): string {
    return this.customerLabels[status] || status;
  }

  /**
   * Check whether status should be visible to customer tracking.
   */
  isCustomerVisible(status: OrderStatus): boolean {
    // Assessment and rework are internal stages unless exposed
    return (
      status !== OrderStatus.DRAFT &&
      status !== OrderStatus.REWORK_REQUIRED &&
      status !== OrderStatus.ASSESSMENT
    );
  }
}
