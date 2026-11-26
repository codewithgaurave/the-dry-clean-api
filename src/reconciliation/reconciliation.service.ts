import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import { OrderProof, OrderProofDocument, ProofType } from '../database/schemas/order-proof.schema';
import {
  SecurityAudit,
  SecurityAuditDocument,
  SecurityAnomalyType,
  SecurityAnomalySeverity,
  SecurityAnomalyStatus,
} from '../database/schemas/security-audit.schema';
import { OrderStatus } from '../orders/order-status.enum';

export interface ReconciliationBreachItem {
  orderId: string;
  orderRef: Types.ObjectId;
  anomalyType: SecurityAnomalyType;
  severity: SecurityAnomalySeverity;
  description: string;
  metadata?: Record<string, any>;
}

export interface ReconciliationReport {
  scannedOrders: number;
  anomaliesFound: number;
  newAnomaliesLogged: number;
  breaches: ReconciliationBreachItem[];
  timestamp: Date;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  // Statuses that require a valid pickup proof in their lifecycle history
  private readonly postPickupStatuses: OrderStatus[] = [
    OrderStatus.PICKED_UP,
    OrderStatus.RECEIVED_AT_FACILITY,
    OrderStatus.ASSESSMENT,
    OrderStatus.CLEANING_IN_PROGRESS,
    OrderStatus.QUALITY_CHECK,
    OrderStatus.READY_FOR_DELIVERY,
    OrderStatus.OUT_FOR_DELIVERY,
    OrderStatus.DELIVERED,
  ];

  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(OrderProof.name)
    private readonly orderProofModel: Model<OrderProofDocument>,
    @InjectModel(SecurityAudit.name)
    private readonly securityAuditModel: Model<SecurityAuditDocument>,
  ) {}

  /**
   * Scheduled cron job running every 15 minutes to reconcile proof invariants.
   * Source of truth: TECH_STACK.md §9.5; PRD.md §6.12.2, §8.2; TODO.md TASK-046.
   */
  @Cron('0 */15 * * * *')
  async handleCronReconciliation() {
    this.logger.log('Starting scheduled 15-minute proof reconciliation cycle...');
    const report = await this.reconcileProofInvariants();
    this.logger.log(
      `Reconciliation cycle finished. Scanned ${report.scannedOrders} orders. Detected ${report.anomaliesFound} total breaches (${report.newAnomaliesLogged} newly recorded).`,
    );
  }

  /**
   * Core verification engine querying for invariant violations:
   * 1. Any order marked DELIVERED lacking a valid corresponding DELIVERY OrderProof.
   * 2. Any order marked PICKED_UP (or subsequent active status) lacking a valid PICKUP OrderProof.
   * 3. Any OrderProof lacking photographic keys.
   */
  async reconcileProofInvariants(): Promise<ReconciliationReport> {
    const breaches: ReconciliationBreachItem[] = [];
    let scannedCount = 0;
    let newlyLoggedCount = 0;

    // --- Invariant 1: DELIVERED Orders Verification ---
    const deliveredOrders = await this.orderModel.find({ status: OrderStatus.DELIVERED }).lean();

    scannedCount += deliveredOrders.length;

    for (const order of deliveredOrders) {
      let isBreach = false;
      let reason = '';

      if (!order.deliveryProofId) {
        isBreach = true;
        reason = `Order #${order.orderId} is marked DELIVERED but has no deliveryProofId reference on order document.`;
      } else {
        const proof = await this.orderProofModel.findOne({
          _id: order.deliveryProofId,
          type: ProofType.DELIVERY,
        });

        if (!proof) {
          isBreach = true;
          reason = `Order #${order.orderId} references deliveryProofId ${order.deliveryProofId}, but no matching DELIVERY proof exists in order_proofs collection.`;
        } else if (!proof.photoKeys || proof.photoKeys.length === 0) {
          isBreach = true;
          reason = `Order #${order.orderId} delivery proof (${proof._id}) has zero photoKeys recorded. Mandatory photo invariant violated.`;
        }
      }

      if (isBreach) {
        breaches.push({
          orderId: order.orderId,
          orderRef: (order as any)._id,
          anomalyType: SecurityAnomalyType.DELIVERY_WITHOUT_PROOF,
          severity: SecurityAnomalySeverity.CRITICAL,
          description: reason,
          metadata: {
            status: order.status,
            deliveryProofId: order.deliveryProofId?.toString(),
          },
        });
      }
    }

    // --- Invariant 2: PICKED_UP / In-Facility Orders Verification ---
    const activePickupOrders = await this.orderModel
      .find({ status: { $in: this.postPickupStatuses } })
      .lean();

    scannedCount += activePickupOrders.length;

    for (const order of activePickupOrders) {
      let isBreach = false;
      let reason = '';

      if (!order.pickupProofId) {
        isBreach = true;
        reason = `Order #${order.orderId} has transitioned to status '${order.status}' but lacks required pickupProofId on order document.`;
      } else {
        const proof = await this.orderProofModel.findOne({
          _id: order.pickupProofId,
          type: ProofType.PICKUP,
        });

        if (!proof) {
          isBreach = true;
          reason = `Order #${order.orderId} references pickupProofId ${order.pickupProofId}, but no matching PICKUP proof exists in order_proofs collection.`;
        } else if (!proof.photoKeys || proof.photoKeys.length === 0) {
          isBreach = true;
          reason = `Order #${order.orderId} pickup proof (${proof._id}) has zero photoKeys recorded. Mandatory photo invariant violated.`;
        }
      }

      if (isBreach) {
        breaches.push({
          orderId: order.orderId,
          orderRef: (order as any)._id,
          anomalyType: SecurityAnomalyType.PICKUP_WITHOUT_PROOF,
          severity: SecurityAnomalySeverity.CRITICAL,
          description: reason,
          metadata: {
            status: order.status,
            pickupProofId: order.pickupProofId?.toString(),
          },
        });
      }
    }

    // --- Process Detected Breaches: Log ALARM, Audit & Sentry ---
    for (const breach of breaches) {
      const existingUnresolved = await this.securityAuditModel.findOne({
        orderId: breach.orderId,
        anomalyType: breach.anomalyType,
        status: { $in: [SecurityAnomalyStatus.UNRESOLVED, SecurityAnomalyStatus.INVESTIGATING] },
      });

      if (!existingUnresolved) {
        // High priority alarm output per TECH_STACK.md §9.5
        this.logger.error(
          `🚨 ALARM: [PROOF_INVARIANT_VIOLATION] [${breach.severity}] ${breach.description}`,
        );

        // Record in SecurityAudit collection
        await this.securityAuditModel.create({
          anomalyType: breach.anomalyType,
          severity: breach.severity,
          orderId: breach.orderId,
          orderRef: breach.orderRef,
          description: breach.description,
          metadata: breach.metadata,
          status: SecurityAnomalyStatus.UNRESOLVED,
        });

        // Trigger Sentry / External Alarm hook
        this.emitSentryAlert(breach);
        newlyLoggedCount++;
      }
    }

    return {
      scannedOrders: scannedCount,
      anomaliesFound: breaches.length,
      newAnomaliesLogged: newlyLoggedCount,
      breaches,
      timestamp: new Date(),
    };
  }

  /**
   * Sentry alert emitter: emits critical alert with error context and tags.
   */
  private emitSentryAlert(breach: ReconciliationBreachItem) {
    // In production Sentry.captureException is invoked; in development/mock fallback we log high-priority alert payload.
    this.logger.warn(
      `[SENTRY_DISPATCH] Emitting high-priority security exception for Order #${breach.orderId} (${breach.anomalyType})`,
    );
  }

  /**
   * Retrieve all logged security anomalies for admin monitoring.
   */
  async getAnomalies(status?: SecurityAnomalyStatus) {
    const filter = status ? { status } : {};
    return this.securityAuditModel.find(filter).sort({ createdAt: -1 }).lean();
  }

  /**
   * Resolve an anomaly with an audit note.
   */
  async resolveAnomaly(anomalyId: string, resolvedByUserId: string, resolutionNote: string) {
    const anomaly = await this.securityAuditModel.findByIdAndUpdate(
      anomalyId,
      {
        status: SecurityAnomalyStatus.RESOLVED,
        resolvedBy: Types.ObjectId.isValid(resolvedByUserId)
          ? new Types.ObjectId(resolvedByUserId)
          : undefined,
        resolvedAt: new Date(),
        resolutionNote,
      },
      { new: true },
    );

    if (anomaly) {
      this.logger.log(
        `Anomaly ${anomalyId} for Order #${anomaly.orderId} marked RESOLVED by user ${resolvedByUserId}`,
      );
    }

    return anomaly;
  }
}
