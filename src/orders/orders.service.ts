import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import {
  OrderStatusEvent,
  OrderStatusEventDocument,
} from '../database/schemas/order-status-event.schema';
import {
  DeliveryTask,
  DeliveryTaskDocument,
  TaskType,
  TaskStatus,
} from '../database/schemas/delivery-task.schema';
import {
  OrderProof,
  OrderProofDocument,
  ProofReviewStatus,
} from '../database/schemas/order-proof.schema';
import {
  SupportTicket,
  SupportTicketDocument,
  SupportTicketType,
  SupportTicketStatus,
  TicketPriority,
} from '../database/schemas/support-ticket.schema';
import { User, UserDocument } from '../database/schemas/user.schema';
import { OrderStatus, OrderActorRole } from './order-status.enum';
import { OrderTransitionService } from './order-transition.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { RescheduleOrderDto } from './dto/reschedule-order.dto';
import { ReportIssueDto, SupportTicketResponse } from './dto/report-issue.dto';
import { OrderProofResponseDto } from './dto/order-proof-response.dto';
import { AdminListOrdersQueryDto } from './dto/admin-list-orders-query.dto';
import { AdminAssignOrderDto } from './dto/admin-assign-order.dto';
import { ReviewProofDto, ProofReviewAction } from './dto/review-proof.dto';
import { StorageService } from '../storage/storage.service';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';

export interface PaginatedOrdersResult {
  orders: OrderDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminPaginatedOrdersResult {
  orders: OrderDocument[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminOrderDetailResult {
  order: OrderDocument;
  tasks: DeliveryTaskDocument[];
  events: OrderStatusEventDocument[];
}

/**
 * Service for customer order queries, detail inspection, status history timeline,
 * and order cancellation/rescheduling workflows.
 * Enforces strict customer tenancy at all times.
 * Source of truth: PRD.md §6.8 (FR-ORD-1 to FR-ORD-4), §6.9, §8.3, §10; TODO.md TASK-030, TASK-033.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(OrderStatusEvent.name)
    private readonly orderStatusEventModel: Model<OrderStatusEventDocument>,
    @InjectModel(DeliveryTask.name)
    private readonly deliveryTaskModel: Model<DeliveryTaskDocument>,
    private readonly orderTransitionService: OrderTransitionService,
    @Optional()
    @InjectModel(OrderProof.name)
    private readonly orderProofModel?: Model<OrderProofDocument>,
    @Optional()
    @InjectModel(SupportTicket.name)
    private readonly supportTicketModel?: Model<SupportTicketDocument>,
    @Optional()
    private readonly storageService?: StorageService,
    @Optional()
    private readonly outboxPublisher?: OutboxPublisherService,
    @Optional()
    @InjectModel(User.name)
    private readonly userModel?: Model<UserDocument>,
  ) {}

  /**
   * Retrieves paginated orders strictly belonging to the authenticated customer.
   * Supports filtering by active vs past orders or explicit order status.
   */
  async listCustomerOrders(
    userId: string | Types.ObjectId,
    query: ListOrdersQueryDto,
  ): Promise<PaginatedOrdersResult> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const filter: any = { userId: userObjectId };
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    if (query.status) {
      const normalizedStatus = query.status.trim().toLowerCase();
      if (normalizedStatus === 'active') {
        // Active orders: in-flight statuses (not delivered or cancelled)
        filter.status = {
          $nin: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
        };
      } else if (normalizedStatus === 'past') {
        // Past orders: terminal completed or cancelled statuses
        filter.status = {
          $in: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
        };
      } else if (
        Object.values(OrderStatus).includes(query.status.trim().toUpperCase() as OrderStatus)
      ) {
        filter.status = query.status.trim().toUpperCase();
      }
    }

    const [orders, total] = await Promise.all([
      this.orderModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.orderModel.countDocuments(filter).exec(),
    ]);

    const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

    return {
      orders,
      total,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Retrieves full details of a specific order belonging to the customer.
   * Accepts either MongoDB ObjectId or canonical orderId (e.g. TC402736).
   * Enforces strict tenancy: throws 404 if the order does not belong to this user.
   */
  async getCustomerOrderById(
    userId: string | Types.ObjectId,
    orderIdentifier: string,
  ): Promise<OrderDocument> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    const query: any = { userId: userObjectId };

    if (Types.ObjectId.isValid(orderIdentifier)) {
      query.$or = [{ _id: new Types.ObjectId(orderIdentifier) }, { orderId: orderIdentifier }];
    } else {
      query.orderId = orderIdentifier;
    }

    const order = await this.orderModel.findOne(query).exec();

    if (!order) {
      throw new NotFoundException(`Order not found or you are not authorized to view this order.`);
    }

    return order;
  }

  /**
   * Retrieves chronological status event history for an order.
   * Enforces strict tenancy: ensures the requesting customer owns the order first.
   */
  async getCustomerOrderEvents(
    userId: string | Types.ObjectId,
    orderIdentifier: string,
  ): Promise<OrderStatusEventDocument[]> {
    // 1. Verify tenancy and existence
    const order = await this.getCustomerOrderById(userId, orderIdentifier);

    // 2. Fetch chronological status event history
    const events = await this.orderStatusEventModel
      .find({
        $or: [{ orderRef: order._id }, { orderId: order.orderId }],
      })
      .sort({ timestamp: 1, createdAt: 1 })
      .exec();

    return events;
  }

  /**
   * Cancels an eligible customer order.
   * Enforces business rules:
   * Cancellation is allowed only if order is in CONFIRMED or PICKUP_SCHEDULED (or RESCHEDULED).
   * If in CLEANING_IN_PROGRESS or later, returns 400 with a clear explanation.
   * Records OrderStatusEvent and cancels associated DeliveryTasks.
   * Source of truth: PRD.md §6.8 (FR-ORD-3), §8.3; TODO.md TASK-033.
   */
  async cancelCustomerOrder(
    userId: string | Types.ObjectId,
    orderIdentifier: string,
    dto?: CancelOrderDto,
  ): Promise<OrderDocument> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    // 1. Verify tenancy & retrieve order
    const order = await this.getCustomerOrderById(userObjectId, orderIdentifier);

    // 2. Enforce business rules for cancellation eligibility
    const cancellableStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.PICKUP_SCHEDULED,
      OrderStatus.RESCHEDULED,
      OrderStatus.PAYMENT_PENDING,
      OrderStatus.PAYMENT_FAILED,
    ];

    if (!cancellableStatuses.includes(order.status as OrderStatus)) {
      throw new BadRequestException(
        `Cancellation is not allowed for order ${order.orderId} in status '${order.status}'. ` +
          `Orders can only be cancelled while in CONFIRMED or PICKUP_SCHEDULED status.`,
      );
    }

    const cancelReason = dto?.reason?.trim() || 'Cancelled by customer';

    // 3. Execute transactional order status transition
    const transitionResult = await this.orderTransitionService.transitionOrderStatus(
      order.orderId,
      OrderStatus.CANCELLED,
      {
        actorRole: OrderActorRole.CUSTOMER,
        actorId: userObjectId.toString(),
        note: cancelReason,
      },
    );

    // 4. Update and cancel any open delivery tasks for this order
    await this.deliveryTaskModel.updateMany(
      {
        orderId: order.orderId,
        status: { $in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] },
      },
      {
        $set: {
          status: TaskStatus.FAILED,
          failureReason: `Order cancelled by customer: ${cancelReason}`,
        },
      },
    );

    return transitionResult.order;
  }

  /**
   * Reschedules the pickup window for an eligible customer order.
   * Enforces business rules:
   * Rescheduling is allowed only if order has not yet been collected (CONFIRMED, PICKUP_SCHEDULED, RESCHEDULED, PICKUP_FAILED).
   * If already collected or in processing, returns 400 with a clear explanation.
   * Records OrderStatusEvent and updates DeliveryTask schedule.
   * Source of truth: PRD.md §6.8 (FR-ORD-4), §8.3; TODO.md TASK-033.
   */
  async rescheduleCustomerOrder(
    userId: string | Types.ObjectId,
    orderIdentifier: string,
    dto: RescheduleOrderDto,
  ): Promise<OrderDocument> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    // 1. Verify tenancy & retrieve order
    const order = await this.getCustomerOrderById(userObjectId, orderIdentifier);

    // 2. Enforce business rules for rescheduling eligibility
    const reschedulableStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.PICKUP_SCHEDULED,
      OrderStatus.RESCHEDULED,
      OrderStatus.PICKUP_FAILED,
    ];

    if (!reschedulableStatuses.includes(order.status as OrderStatus)) {
      throw new BadRequestException(
        `Rescheduling pickup is not allowed for order ${order.orderId} in status '${order.status}'. ` +
          `Garments have already been collected or order is in processing.`,
      );
    }

    const note = dto.reason?.trim()
      ? `Rescheduled pickup to ${dto.date} (${dto.timeSlot}): ${dto.reason.trim()}`
      : `Rescheduled pickup to ${dto.date} (${dto.timeSlot})`;

    // 3. Transition status or record audit event
    if (order.status !== OrderStatus.RESCHEDULED) {
      await this.orderTransitionService.transitionOrderStatus(
        order.orderId,
        OrderStatus.RESCHEDULED,
        {
          actorRole: OrderActorRole.CUSTOMER,
          actorId: userObjectId.toString(),
          note,
        },
      );
    } else {
      await this.orderStatusEventModel.create([
        {
          orderId: order.orderId,
          orderRef: order._id,
          previousStatus: OrderStatus.RESCHEDULED,
          status: OrderStatus.RESCHEDULED,
          updatedBy: {
            actorRole: OrderActorRole.CUSTOMER,
            actorId: userObjectId.toString(),
          },
          timestamp: new Date(),
          note,
        },
      ]);
    }

    // 4. Update currentScheduledWindow on order
    order.currentScheduledWindow = {
      type: 'PICKUP',
      date: dto.date,
      timeSlot: dto.timeSlot,
    };
    order.status = OrderStatus.RESCHEDULED;
    const updatedOrder = await order.save();

    // 5. Update DeliveryTask schedule
    await this.deliveryTaskModel.updateMany(
      {
        orderId: order.orderId,
        taskType: TaskType.PICKUP,
      },
      {
        $set: {
          scheduledDate: dto.date,
          scheduledTimeWindow: dto.timeSlot,
          status: TaskStatus.ASSIGNED,
        },
      },
    );

    return updatedOrder;
  }

  /**
   * Retrieves signed proof of delivery / pickup records for the customer's own order.
   * Strictly enforces customer tenancy (throws 404 if not owned by customer).
   * Generates short-lived signed S3 download URLs for photo evidence.
   * Source of truth: PRD.md §6.12.3 (FR-POD-22, FR-POD-29); TECH_STACK.md §9.6, §9.7; TODO.md TASK-040.
   */
  async getCustomerOrderProofs(
    userId: string | Types.ObjectId,
    orderIdentifier: string,
  ): Promise<OrderProofResponseDto[]> {
    // 1. Verify customer tenancy and order existence
    const order = await this.getCustomerOrderById(userId, orderIdentifier);

    if (!this.orderProofModel) {
      return [];
    }

    // 2. Fetch proofs belonging to this order
    const proofs = await this.orderProofModel
      .find({
        $or: [{ orderRef: order._id }, { orderId: order.orderId }],
      })
      .sort({ createdAt: 1 })
      .exec();

    // 3. Generate signed URLs for private photos and map response
    const results: OrderProofResponseDto[] = [];
    for (const proof of proofs) {
      const photoUrls: string[] = [];
      if (proof.photoKeys && proof.photoKeys.length > 0) {
        for (const key of proof.photoKeys) {
          if (this.storageService) {
            try {
              const url = await this.storageService.getSignedDownloadUrl(key, 900);
              photoUrls.push(url);
            } catch {
              photoUrls.push(key);
            }
          } else {
            photoUrls.push(key);
          }
        }
      }

      results.push({
        id: proof._id.toString(),
        orderId: proof.orderId,
        taskId: proof.taskId,
        type: proof.type,
        handoverMethod: proof.handoverMethod,
        capturedAt: (proof.capturedAt || proof.createdAt || new Date()).toISOString(),
        receivedAt: (proof.receivedAt || proof.createdAt || new Date()).toISOString(),
        photoUrls,
        note: proof.note,
        reviewStatus: proof.reviewStatus,
        flaggedReason: proof.flaggedReason,
      });
    }

    return results;
  }

  /**
   * Reports an issue or disputes a delivery for the customer's own order.
   * Creates an immutable SupportTicket linked to the order and proof.
   * Flags the proof for admin review and emits an outbox event.
   * Source of truth: PRD.md §6.12.3 (FR-POD-23); TECH_STACK.md §7.2, §7.3; TODO.md TASK-040.
   */
  async reportCustomerOrderIssue(
    userId: string | Types.ObjectId,
    orderIdentifier: string,
    dto: ReportIssueDto,
  ): Promise<SupportTicketResponse> {
    const userObjectId = typeof userId === 'string' ? new Types.ObjectId(userId) : userId;

    // 1. Verify customer tenancy and order existence
    const order = await this.getCustomerOrderById(userObjectId, orderIdentifier);

    if (!this.supportTicketModel) {
      throw new BadRequestException('Support ticketing service unavailable.');
    }

    // 2. Resolve and validate associated proof
    let proofObjectId: Types.ObjectId | undefined;
    let associatedProof: OrderProofDocument | null = null;

    if (dto.proofId) {
      if (Types.ObjectId.isValid(dto.proofId)) {
        proofObjectId = new Types.ObjectId(dto.proofId);
      }
    } else if (order.deliveryProofId) {
      proofObjectId = order.deliveryProofId;
    }

    if (proofObjectId && this.orderProofModel) {
      associatedProof = await this.orderProofModel
        .findOne({
          _id: proofObjectId,
          $or: [{ orderRef: order._id }, { orderId: order.orderId }],
        })
        .exec();

      if (!associatedProof && dto.proofId) {
        throw new BadRequestException(
          `Proof ID '${dto.proofId}' does not belong to order ${order.orderId}.`,
        );
      }
    }

    // 3. Generate human-readable ticket number (e.g. TKT-TC402736-5821)
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const sanitizedOrderId = order.orderId.replace(/[^A-Za-z0-9]/g, '');
    const ticketNumber = `TKT-${sanitizedOrderId}-${randomSuffix}`;

    const subject =
      dto.subject?.trim() || `Delivery dispute for order #${order.orderId}: ${dto.reason}`;

    // 4. Create and save SupportTicket document
    const ticket = new this.supportTicketModel({
      ticketNumber,
      userId: userObjectId,
      orderId: order.orderId,
      orderRef: order._id,
      proofId: associatedProof?._id || proofObjectId,
      type: SupportTicketType.DELIVERY_DISPUTE,
      subject,
      description: dto.description.trim(),
      status: SupportTicketStatus.OPEN,
      priority: TicketPriority.HIGH,
      metadata: {
        reason: dto.reason,
        reportedVia: 'CUSTOMER_APP',
      },
    });

    const savedTicket = await ticket.save();

    // 5. Flag proof for admin review if attached
    if (associatedProof) {
      associatedProof.reviewStatus = ProofReviewStatus.FLAGGED;
      associatedProof.flaggedReason = `Customer dispute: ${dto.reason}`;
      await associatedProof.save();
    }

    // 6. Publish outbox message for async notifications / admin queue
    if (this.outboxPublisher) {
      try {
        await this.outboxPublisher.publish('SUPPORT_TICKET_CREATED', {
          ticketId: savedTicket._id.toString(),
          ticketNumber: savedTicket.ticketNumber,
          orderId: order.orderId,
          userId: userObjectId.toString(),
          proofId: associatedProof?._id?.toString() || proofObjectId?.toString(),
          reason: dto.reason,
        });
      } catch {
        // Non-fatal outbox logging
      }
    }

    return {
      ticketId: savedTicket._id.toString(),
      ticketNumber: savedTicket.ticketNumber,
      orderId: savedTicket.orderId || order.orderId,
      proofId: savedTicket.proofId?.toString(),
      type: savedTicket.type,
      subject: savedTicket.subject,
      description: savedTicket.description,
      status: savedTicket.status,
      priority: savedTicket.priority,
      createdAt: (savedTicket.createdAt || new Date()).toISOString(),
    };
  }

  /**
   * Retrieves paginated orders for administration and facility tracking.
   * Supports filtering by lifecycle status, customer text search, and date ranges.
   */
  async listAdminOrders(query: AdminListOrdersQueryDto): Promise<AdminPaginatedOrdersResult> {
    const filter: any = {};
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(100, Math.max(1, query.limit || 20));
    const skip = (page - 1) * limit;

    // Status filter: handle 'ALL', specific status, or comma-separated list
    if (query.status && query.status.trim() && query.status.trim().toUpperCase() !== 'ALL') {
      const parts = query.status.split(',').map((s) => s.trim().toUpperCase());
      if (parts.length === 1) {
        filter.status = parts[0];
      } else {
        filter.status = { $in: parts };
      }
    }

    // Date range filter
    if (query.startDate || query.endDate) {
      filter.createdAt = {};
      if (query.startDate) {
        filter.createdAt.$gte = new Date(query.startDate);
      }
      if (query.endDate) {
        filter.createdAt.$lte = new Date(query.endDate);
      }
    }

    // Text search on orderId or customer info
    if (query.search && query.search.trim()) {
      const term = query.search.trim();
      const regex = new RegExp(term, 'i');
      let matchedUserIds: Types.ObjectId[] = [];

      if (this.userModel) {
        try {
          const matchedUsers = await this.userModel
            .find({
              $or: [{ phone: regex }, { name: regex }, { email: regex }],
            })
            .select('_id')
            .exec();
          matchedUserIds = matchedUsers.map((u) => u._id as Types.ObjectId);
        } catch {
          // ignore search error
        }
      }

      filter.$or = [
        { orderId: regex },
        ...(matchedUserIds.length > 0 ? [{ userId: { $in: matchedUserIds } }] : []),
      ];
    }

    const [orders, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .populate('userId', 'name phone email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.orderModel.countDocuments(filter).exec(),
    ]);

    return {
      orders,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Retrieves complete order record for operational inspection.
   * Includes customer snapshot, attached delivery tasks, proofs, and chronological audit events.
   */
  async getAdminOrderById(orderIdentifier: string): Promise<AdminOrderDetailResult> {
    const query: any = Types.ObjectId.isValid(orderIdentifier)
      ? { $or: [{ _id: new Types.ObjectId(orderIdentifier) }, { orderId: orderIdentifier }] }
      : { orderId: orderIdentifier };

    const order = await this.orderModel
      .findOne(query)
      .populate('userId', 'name phone email role avatar')
      .populate('pickupProofId')
      .populate('deliveryProofId')
      .exec();

    if (!order) {
      throw new NotFoundException(`Order '${orderIdentifier}' not found.`);
    }

    const [tasks, events] = await Promise.all([
      this.deliveryTaskModel
        .find({ orderId: order.orderId })
        .populate('agentId', 'name phone role')
        .sort({ createdAt: -1 })
        .exec(),
      this.orderStatusEventModel.find({ orderId: order.orderId }).sort({ timestamp: 1 }).exec(),
    ]);

    return {
      order,
      tasks,
      events,
    };
  }

  /**
   * Transitions order state on behalf of an operations administrator or facility staff member.
   * Enforces role-based permissions through OrderStateMachineService.
   */
  async updateOrderStatusByAdmin(
    orderIdentifier: string,
    targetStatus: OrderStatus,
    actor: UserDocument,
    note?: string,
  ) {
    const query: any = Types.ObjectId.isValid(orderIdentifier)
      ? { $or: [{ _id: new Types.ObjectId(orderIdentifier) }, { orderId: orderIdentifier }] }
      : { orderId: orderIdentifier };

    const order = await this.orderModel.findOne(query).exec();
    if (!order) {
      throw new NotFoundException(`Order '${orderIdentifier}' not found.`);
    }

    return this.orderTransitionService.transitionOrderStatus(order.orderId, targetStatus, {
      actorRole: actor.role || OrderActorRole.ADMIN,
      actorId: actor._id.toString(),
      note: note || `Transition to ${targetStatus} executed by ${actor.name || actor.role}.`,
    });
  }

  /**
   * Assigns courier/valet agent to an order's pickup or delivery task.
   */
  async assignOrderTaskByAdmin(
    orderIdentifier: string,
    dto: AdminAssignOrderDto,
    actor: UserDocument,
  ): Promise<DeliveryTaskDocument> {
    const query: any = Types.ObjectId.isValid(orderIdentifier)
      ? { $or: [{ _id: new Types.ObjectId(orderIdentifier) }, { orderId: orderIdentifier }] }
      : { orderId: orderIdentifier };

    const order = await this.orderModel.findOne(query).exec();
    if (!order) {
      throw new NotFoundException(`Order '${orderIdentifier}' not found.`);
    }

    // Determine task type based on lifecycle if not explicitly passed
    let taskType = dto.taskType;
    if (!taskType) {
      if (
        order.status === OrderStatus.READY_FOR_DELIVERY ||
        order.status === OrderStatus.OUT_FOR_DELIVERY ||
        order.status === OrderStatus.DELIVERED
      ) {
        taskType = TaskType.DELIVERY;
      } else {
        taskType = TaskType.PICKUP;
      }
    }

    const agentObjectId = new Types.ObjectId(dto.agentId);

    // Look for existing active task of the same type for this order
    let task = await this.deliveryTaskModel.findOne({ orderId: order.orderId, taskType }).exec();

    if (task) {
      task.agentId = agentObjectId;
      task.status = TaskStatus.ASSIGNED;
      if (dto.scheduledDate) task.scheduledDate = dto.scheduledDate;
      if (dto.scheduledTimeWindow) task.scheduledTimeWindow = dto.scheduledTimeWindow;
      await task.save();
    } else {
      const prefix = taskType === TaskType.PICKUP ? 'TSK_P' : 'TSK_D';
      const taskId = `${prefix}_${order.orderId}_${Date.now().toString().slice(-4)}`;
      task = await this.deliveryTaskModel.create({
        taskId,
        orderId: order.orderId,
        orderRef: order._id,
        agentId: agentObjectId,
        taskType,
        status: TaskStatus.ASSIGNED,
        scheduledDate:
          dto.scheduledDate ||
          order.currentScheduledWindow?.date ||
          new Date().toISOString().split('T')[0],
        scheduledTimeWindow:
          dto.scheduledTimeWindow ||
          order.currentScheduledWindow?.timeSlot ||
          '10:00 AM - 12:00 PM',
      });
    }

    // If order was CONFIRMED and task is PICKUP, transition to PICKUP_SCHEDULED
    if (order.status === OrderStatus.CONFIRMED && taskType === TaskType.PICKUP) {
      try {
        await this.orderTransitionService.transitionOrderStatus(
          order.orderId,
          OrderStatus.PICKUP_SCHEDULED,
          {
            actorRole: actor.role || OrderActorRole.OPERATIONS,
            actorId: actor._id.toString(),
            note: `Courier agent assigned for pickup.`,
          },
        );
      } catch {
        // Non-fatal
      }
    }

    // Publish assignment event
    if (this.outboxPublisher) {
      try {
        await this.outboxPublisher.publish('AGENT_ASSIGNED_TO_TASK', {
          taskId: task.taskId,
          orderId: order.orderId,
          agentId: dto.agentId,
          taskType,
          assignedBy: actor._id.toString(),
        });
      } catch {
        // Non-fatal
      }
    }

    return task;
  }

  /**
   * Retrieves photographic proofs in the operational review queue with signed S3 viewing URLs.
   * Allows filtering by review status ('PENDING' by default, 'VERIFIED', 'FLAGGED', or 'ALL').
   */
  async getAdminProofsReviewQueue(
    status: string = 'PENDING',
    page: number = 1,
    limit: number = 20,
  ) {
    if (!this.orderProofModel) {
      throw new BadRequestException('OrderProof model is not configured.');
    }

    const filter: any = {};
    const normalizedStatus = (status || 'PENDING').trim().toUpperCase();
    if (normalizedStatus !== 'ALL') {
      filter.reviewStatus = normalizedStatus;
    }

    const skip = Math.max(0, (page - 1) * limit);

    const [proofs, total, pendingCount] = await Promise.all([
      this.orderProofModel
        .find(filter)
        .populate('agentId', 'name phone role')
        .populate('reviewedBy', 'name role')
        .populate('orderRef', 'status customerPhone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.orderProofModel.countDocuments(filter).exec(),
      this.orderProofModel.countDocuments({ reviewStatus: ProofReviewStatus.PENDING }).exec(),
    ]);

    const enrichedProofs = await Promise.all(
      proofs.map(async (proof) => {
        let photoUrls: string[] = [];
        if (this.storageService) {
          photoUrls = await Promise.all(
            (proof.photoKeys || []).map((k) => this.storageService!.getSignedDownloadUrl(k)),
          );
        } else {
          photoUrls = proof.photoKeys || [];
        }

        const capturedTime = proof.capturedAt ? new Date(proof.capturedAt).getTime() : 0;
        const receivedTime = proof.receivedAt ? new Date(proof.receivedAt).getTime() : 0;
        const clockDriftSeconds =
          capturedTime && receivedTime
            ? Math.round(Math.abs(receivedTime - capturedTime) / 1000)
            : 0;

        return {
          id: proof._id.toString(),
          orderId: proof.orderId,
          taskId: proof.taskId,
          type: proof.type,
          handoverMethod: proof.handoverMethod,
          capturedAt: (proof.capturedAt || new Date()).toISOString(),
          receivedAt: (proof.receivedAt || new Date()).toISOString(),
          clockDriftSeconds,
          geo: proof.geo,
          note: proof.note,
          photoKeys: proof.photoKeys,
          photoUrls,
          reviewStatus: proof.reviewStatus,
          flaggedReason: proof.flaggedReason,
          reviewedBy: proof.reviewedBy,
          reviewedAt: proof.reviewedAt ? new Date(proof.reviewedAt).toISOString() : undefined,
          agent: proof.agentId,
        };
      }),
    );

    return {
      proofs: enrichedProofs,
      total,
      pendingCount,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * Reviews photographic proof as VERIFIED or FLAGGED.
   * If flagged, generates an operations support dispute ticket and emits an outbox alert.
   */
  async reviewAdminProof(proofId: string, dto: ReviewProofDto, reviewer: UserDocument) {
    if (!this.orderProofModel) {
      throw new BadRequestException('OrderProof model is not configured.');
    }

    const query: any = Types.ObjectId.isValid(proofId)
      ? { $or: [{ _id: new Types.ObjectId(proofId) }, { taskId: proofId }] }
      : { taskId: proofId };

    const proof = await this.orderProofModel.findOne(query).exec();
    if (!proof) {
      throw new NotFoundException(`Order proof '${proofId}' not found.`);
    }

    const previousStatus = proof.reviewStatus;
    const isFlagged = dto.action === ProofReviewAction.FLAGGED;

    proof.reviewStatus = isFlagged ? ProofReviewStatus.FLAGGED : ProofReviewStatus.VERIFIED;
    proof.reviewedBy = reviewer._id;
    proof.reviewedAt = new Date();
    proof.flaggedReason = isFlagged
      ? dto.reason || 'Flagged during quality inspection.'
      : undefined;

    const savedProof = await proof.save();

    let createdTicket: SupportTicketDocument | null = null;

    // If FLAGGED, generate operational follow-up dispute ticket
    if (isFlagged && this.supportTicketModel) {
      const order = await this.orderModel.findOne({ orderId: proof.orderId }).exec();
      const ticketNumber = `TKT-FLG-${proof.orderId}-${Math.floor(1000 + Math.random() * 9000)}`;

      createdTicket = await this.supportTicketModel.create({
        ticketNumber,
        userId: order ? order.userId : reviewer._id,
        orderId: proof.orderId,
        orderRef: proof.orderRef,
        proofId: proof._id,
        type: SupportTicketType.DELIVERY_DISPUTE,
        subject: `Flagged ${proof.type} Proof Audit: Order #${proof.orderId}`,
        description: `Operations review by ${reviewer.name || reviewer.role}: ${dto.reason || 'Proof photos failed compliance check.'}`,
        status: SupportTicketStatus.OPEN,
        priority: TicketPriority.HIGH,
      });
    }

    // Publish outbox event
    if (this.outboxPublisher) {
      try {
        await this.outboxPublisher.publish(
          isFlagged ? 'PROOF_FLAGGED_BY_ADMIN' : 'PROOF_VERIFIED_BY_ADMIN',
          {
            proofId: savedProof._id.toString(),
            orderId: savedProof.orderId,
            taskId: savedProof.taskId,
            previousStatus,
            reviewStatus: savedProof.reviewStatus,
            reviewedBy: reviewer._id.toString(),
            reviewedAt: savedProof.reviewedAt,
            reason: dto.reason,
            ticketNumber: createdTicket?.ticketNumber,
          },
        );
      } catch {
        // Non-fatal outbox publishing
      }
    }

    return {
      success: true,
      proof: {
        id: savedProof._id.toString(),
        orderId: savedProof.orderId,
        taskId: savedProof.taskId,
        type: savedProof.type,
        reviewStatus: savedProof.reviewStatus,
        reviewedBy: reviewer._id.toString(),
        reviewedAt: savedProof.reviewedAt?.toISOString(),
        flaggedReason: savedProof.flaggedReason,
      },
      ticket: createdTicket
        ? {
            ticketNumber: createdTicket.ticketNumber,
            status: createdTicket.status,
            priority: createdTicket.priority,
          }
        : null,
    };
  }
}
