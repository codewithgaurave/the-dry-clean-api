import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import {
  DeliveryTask,
  DeliveryTaskDocument,
  TaskStatus,
  TaskType,
} from '../database/schemas/delivery-task.schema';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import {
  OrderProof,
  OrderProofDocument,
  ProofType,
  HandoverMethod,
  ProofReviewStatus,
} from '../database/schemas/order-proof.schema';
import {
  OrderStatusEvent,
  OrderStatusEventDocument,
} from '../database/schemas/order-status-event.schema';
import { UserDocument } from '../database/schemas/user.schema';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { OrderStateMachineService } from '../orders/order-state-machine.service';
import { OrderStatus, OrderActorRole } from '../orders/order-status.enum';
import { StorageService } from '../storage/storage.service';
import { ImageValidationService, ImageInputFile } from '../storage/image-validation.service';
import { SubmitProofDto, ProofSubmissionResponse } from './dto/submit-proof.dto';
import { RecordFailedAttemptDto, FailedAttemptResponse } from './dto/record-failed-attempt.dto';

/**
 * AgentTasksService:
 * Proof of Pickup (POP) and Proof of Delivery (POD) Verification Engine.
 * Enforces mandatory photo validation, agent assignment checks, and atomic state transitions.
 * Source of truth: PRD.md §6.12.1, §6.12.2; TECH_STACK.md §9.4, §9.5; TODO.md TASK-035.
 */
@Injectable()
export class AgentTasksService {
  private readonly logger = new Logger(AgentTasksService.name);

  constructor(
    @InjectModel(DeliveryTask.name)
    private readonly deliveryTaskModel: Model<DeliveryTaskDocument>,
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(OrderProof.name)
    private readonly orderProofModel: Model<OrderProofDocument>,
    @InjectModel(OrderStatusEvent.name)
    private readonly eventModel: Model<OrderStatusEventDocument>,
    private readonly databaseService: DatabaseService,
    private readonly outboxPublisher: OutboxPublisherService,
    private readonly stateMachine: OrderStateMachineService,
    private readonly storageService: StorageService,
    private readonly imageValidationService: ImageValidationService,
  ) {}

  /**
   * Submits Proof of Pickup or Delivery with photo evidence.
   * Atomically verifies photos, updates task status, transitions order, logs audit event,
   * and creates an immutable OrderProof record.
   */
  async submitProof(
    taskIdOrId: string,
    agent: UserDocument,
    files: ImageInputFile[] = [],
    dto: SubmitProofDto = {},
  ): Promise<ProofSubmissionResponse> {
    // 1. Resolve photo keys: process uploaded multipart files and/or pre-uploaded keys
    const photoKeys: string[] = [];

    // Parse pre-uploaded keys if passed in DTO
    if (dto.photoKeys) {
      if (Array.isArray(dto.photoKeys)) {
        photoKeys.push(
          ...dto.photoKeys.filter((k) => typeof k === 'string' && k.trim().length > 0),
        );
      } else if (typeof dto.photoKeys === 'string') {
        try {
          const parsed = JSON.parse(dto.photoKeys);
          if (Array.isArray(parsed)) {
            photoKeys.push(...parsed.filter((k) => typeof k === 'string' && k.trim().length > 0));
          } else {
            photoKeys.push(dto.photoKeys.trim());
          }
        } catch {
          photoKeys.push(dto.photoKeys.trim());
        }
      }
    }

    // Process and sanitize any uploaded multipart files
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const validated = await this.imageValidationService.validateAndSanitize(file);
        const objectKey = `proofs/${taskIdOrId}_${Date.now()}_${i}.${validated.format}`;
        await this.storageService.uploadFile(objectKey, validated.buffer, validated.mimeType, {
          taskId: taskIdOrId,
          agentId: agent._id.toString(),
          width: validated.width.toString(),
          height: validated.height.toString(),
        });
        photoKeys.push(objectKey);
      }
    }

    // MANDATORY PROOF VALIDATION: Zero photos provided must be rejected (PRD.md §6.12.1 FR-POD-2, FR-POD-3)
    if (photoKeys.length === 0) {
      throw new BadRequestException(
        'MANDATORY_PROOF_PHOTO: At least 1 proof photo is required to complete pickup or delivery.',
      );
    }

    // 2. Find DeliveryTask by taskId or MongoDB ObjectId
    const taskQuery = Types.ObjectId.isValid(taskIdOrId)
      ? { $or: [{ _id: new Types.ObjectId(taskIdOrId) }, { taskId: taskIdOrId }] }
      : { taskId: taskIdOrId };

    const task = await this.deliveryTaskModel.findOne(taskQuery);
    if (!task) {
      throw new NotFoundException(`Delivery task '${taskIdOrId}' not found.`);
    }

    // Check if task is already completed
    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException(
        `TASK_ALREADY_COMPLETED: Delivery task '${task.taskId}' is already completed.`,
      );
    }

    // 3. Reject if agent is not assigned to this task (PRD.md §6.12.2 FR-POD-15)
    if (!task.agentId || task.agentId.toString() !== agent._id.toString()) {
      throw new ForbiddenException(
        `UNASSIGNED_AGENT: Agent '${agent._id}' is not assigned to delivery task '${task.taskId}'.`,
      );
    }

    // 4. Find Order associated with this task
    const order = await this.orderModel.findOne({ orderId: task.orderId });
    if (!order) {
      throw new NotFoundException(`Order '${task.orderId}' associated with task not found.`);
    }

    // 5. Enforce mandatory lifecycle phase based on task type (PRD.md §6.12.2 FR-POD-15)
    let targetStatus: OrderStatus;
    let proofType: ProofType;

    if (task.taskType === TaskType.PICKUP) {
      proofType = ProofType.PICKUP;
      targetStatus = OrderStatus.PICKED_UP;

      if (order.status !== OrderStatus.PICKUP_SCHEDULED) {
        throw new BadRequestException(
          `INVALID_ORDER_STATE: Order '${order.orderId}' is in status '${order.status}', but must be in 'PICKUP_SCHEDULED' to submit Proof of Pickup.`,
        );
      }
    } else if (task.taskType === TaskType.DELIVERY) {
      proofType = ProofType.DELIVERY;
      targetStatus = OrderStatus.DELIVERED;

      if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {
        throw new BadRequestException(
          `INVALID_ORDER_STATE: Order '${order.orderId}' is in status '${order.status}', but must be in 'OUT_FOR_DELIVERY' to submit Proof of Delivery.`,
        );
      }
    } else {
      throw new BadRequestException(
        `UNSUPPORTED_TASK_TYPE: Task type '${task.taskType}' does not require proof.`,
      );
    }

    // Validate state machine rules
    const previousStatus = order.status;
    const proofIdPlaceholder = new Types.ObjectId().toString();
    this.stateMachine.validateTransition(previousStatus, targetStatus, {
      actorRole: OrderActorRole.AGENT,
      actorId: agent._id.toString(),
      proofId: proofIdPlaceholder,
    });

    // 6. Execute Atomic Transaction (TECH_STACK.md §9.4)
    let createdProof: OrderProofDocument;

    try {
      createdProof = await this.databaseService.withTransaction(async (session) => {
        // A. Create OrderProof document
        const [proof] = await this.orderProofModel.create(
          [
            {
              orderId: order.orderId,
              orderRef: order._id,
              taskId: task.taskId,
              taskRef: task._id,
              type: proofType,
              agentId: agent._id,
              photoKeys,
              capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : new Date(),
              receivedAt: new Date(),
              geo:
                dto.latitude !== undefined && dto.longitude !== undefined
                  ? {
                      latitude: Number(dto.latitude),
                      longitude: Number(dto.longitude),
                      accuracy: dto.accuracy !== undefined ? Number(dto.accuracy) : 0,
                    }
                  : undefined,
              handoverMethod: dto.handoverMethod || HandoverMethod.HANDED_TO_CUSTOMER,
              note: dto.note?.trim(),
              reviewStatus: ProofReviewStatus.PENDING,
            },
          ],
          { session },
        );

        // B. Update Task to COMPLETED and link proofId
        task.status = TaskStatus.COMPLETED;
        task.proofId = proof._id;
        await task.save({ session });

        // C. Update Order status and link corresponding proof ID
        order.status = targetStatus;
        if (targetStatus === OrderStatus.PICKED_UP) {
          order.pickupProofId = proof._id;
        } else if (targetStatus === OrderStatus.DELIVERED) {
          order.deliveryProofId = proof._id;
        }
        await order.save({ session });

        // D. Create immutable OrderStatusEvent audit trail (PRD.md §6.12.2 FR-POD-16)
        await this.eventModel.create(
          [
            {
              orderId: order.orderId,
              orderRef: order._id,
              previousStatus,
              status: targetStatus,
              updatedBy: {
                actorRole: OrderActorRole.AGENT,
                actorId: agent._id.toString(),
              },
              timestamp: new Date(),
              note:
                dto.note ||
                `Proof of ${proofType.toLowerCase()} verified with ${photoKeys.length} photo(s).`,
              proofId: proof._id.toString(),
            },
          ],
          { session },
        );

        // E. Enqueue domain event to Transactional Outbox
        await this.outboxPublisher.publish(
          'ORDER_STATUS_CHANGED',
          {
            orderId: order.orderId,
            orderRef: order._id,
            previousStatus,
            status: targetStatus,
            proofId: proof._id.toString(),
            updatedBy: {
              actorRole: OrderActorRole.AGENT,
              actorId: agent._id.toString(),
            },
            timestamp: new Date(),
          },
          session,
        );

        return proof;
      });
    } catch (error: any) {
      if (error.code === 11000) {
        throw new ConflictException(
          `DUPLICATE_PROOF: A proof submission for task '${task.taskId}' or order '${order.orderId}' type '${proofType}' already exists.`,
        );
      }
      throw error;
    }

    // 7. Generate Signed URLs for immediate client preview
    const signedUrls: string[] = [];
    for (const key of photoKeys) {
      try {
        const signedUrl = await this.storageService.getSignedDownloadUrl(key);
        signedUrls.push(signedUrl);
      } catch (err: any) {
        this.logger.warn(`Failed to generate signed URL for key '${key}': ${err.message}`);
      }
    }

    return {
      success: true,
      proofId: createdProof._id.toString(),
      taskId: task.taskId,
      orderId: order.orderId,
      type: createdProof.type,
      status: targetStatus,
      photoKeys,
      signedUrls,
      handoverMethod: createdProof.handoverMethod,
      capturedAt: createdProof.capturedAt,
      receivedAt: createdProof.receivedAt,
      reviewStatus: createdProof.reviewStatus,
    };
  }

  /**
   * Retrieves an OrderProof by ID with signed photo URLs.
   */
  async getProofById(proofId: string): Promise<any> {
    if (!Types.ObjectId.isValid(proofId)) {
      throw new BadRequestException(`Invalid proof ID '${proofId}'.`);
    }

    const proof = await this.orderProofModel.findById(proofId);
    if (!proof) {
      throw new NotFoundException(`Order proof '${proofId}' not found.`);
    }

    const signedUrls: string[] = [];
    for (const key of proof.photoKeys) {
      try {
        const signedUrl = await this.storageService.getSignedDownloadUrl(key);
        signedUrls.push(signedUrl);
      } catch {
        // Fallback
      }
    }

    return {
      ...proof.toObject(),
      signedUrls,
    };
  }

  /**
   * Records a failed pickup or delivery attempt.
   * Atomically marks the DeliveryTask as FAILED, transitions the order to PICKUP_FAILED
   * or DELIVERY_FAILED, generates an immutable OrderStatusEvent, and publishes a domain event.
   * NOTE: Never marks an order as DELIVERED or PICKED_UP (PRD.md §6.12.1 FR-POD-11, FR-POD-30; TECH_STACK.md §9.5).
   */
  async recordFailedAttempt(
    taskIdOrId: string,
    agent: UserDocument,
    file?: ImageInputFile,
    dto: RecordFailedAttemptDto = { reason: 'CUSTOMER_UNAVAILABLE' },
  ): Promise<FailedAttemptResponse> {
    // 1. Find DeliveryTask by taskId or MongoDB ObjectId
    const taskQuery = Types.ObjectId.isValid(taskIdOrId)
      ? { $or: [{ _id: new Types.ObjectId(taskIdOrId) }, { taskId: taskIdOrId }] }
      : { taskId: taskIdOrId };

    const task = await this.deliveryTaskModel.findOne(taskQuery);
    if (!task) {
      throw new NotFoundException(`Delivery task '${taskIdOrId}' not found.`);
    }

    // 2. Reject if task is already completed
    if (task.status === TaskStatus.COMPLETED) {
      throw new BadRequestException(
        `TASK_ALREADY_COMPLETED: Delivery task '${task.taskId}' is already completed.`,
      );
    }

    // 3. Reject if agent is not assigned to this task
    if (!task.agentId || task.agentId.toString() !== agent._id.toString()) {
      throw new ForbiddenException(
        `UNASSIGNED_AGENT: Agent '${agent._id}' is not assigned to delivery task '${task.taskId}'.`,
      );
    }

    // 4. Find Order associated with this task
    const order = await this.orderModel.findOne({ orderId: task.orderId });
    if (!order) {
      throw new NotFoundException(`Order '${task.orderId}' associated with task not found.`);
    }

    // 5. Determine target order status based on task type
    let targetStatus: OrderStatus;
    if (task.taskType === TaskType.PICKUP) {
      targetStatus = OrderStatus.PICKUP_FAILED;
      if (order.status !== OrderStatus.PICKUP_SCHEDULED) {
        throw new BadRequestException(
          `INVALID_ORDER_STATE: Order '${order.orderId}' is in status '${order.status}', but must be in 'PICKUP_SCHEDULED' to record a failed pickup attempt.`,
        );
      }
    } else if (task.taskType === TaskType.DELIVERY) {
      targetStatus = OrderStatus.DELIVERY_FAILED;
      if (order.status !== OrderStatus.OUT_FOR_DELIVERY) {
        throw new BadRequestException(
          `INVALID_ORDER_STATE: Order '${order.orderId}' is in status '${order.status}', but must be in 'OUT_FOR_DELIVERY' to record a failed delivery attempt.`,
        );
      }
    } else {
      throw new BadRequestException(
        `UNSUPPORTED_TASK_TYPE: Task type '${task.taskType}' does not support failed attempts.`,
      );
    }

    // 6. Validate state machine transition rules
    const previousStatus = order.status;
    this.stateMachine.validateTransition(previousStatus, targetStatus, {
      actorRole: OrderActorRole.AGENT,
      actorId: agent._id.toString(),
    });

    // 7. Process optional photographic evidence (e.g. locked gate / doorstep photo)
    let photoKey: string | undefined = dto.photoKey?.trim();

    if (file) {
      const validated = await this.imageValidationService.validateAndSanitize(file);
      photoKey = `failed-attempts/${task.taskId}_${Date.now()}.${validated.format}`;
      await this.storageService.uploadFile(photoKey, validated.buffer, validated.mimeType, {
        taskId: task.taskId,
        agentId: agent._id.toString(),
        reason: dto.reason,
      });
    }

    // 8. Execute Atomic Transaction (TECH_STACK.md §9.4)
    await this.databaseService.withTransaction(async (session) => {
      // A. Update Task to FAILED and store failure metadata
      task.status = TaskStatus.FAILED;
      task.failureReason = dto.reason;
      if (dto.notes) {
        task.failureNotes = dto.notes.trim();
      }
      if (photoKey) {
        task.failurePhotoKey = photoKey;
      }
      await task.save({ session });

      // B. Update Order status to PICKUP_FAILED or DELIVERY_FAILED (never PICKED_UP or DELIVERED)
      order.status = targetStatus;
      await order.save({ session });

      // C. Record immutable OrderStatusEvent audit trail (PRD.md §6.12.2 FR-POD-16)
      const note = dto.notes
        ? `Failed attempt recorded: ${dto.reason}. Notes: ${dto.notes.trim()}`
        : `Failed attempt recorded: ${dto.reason}.`;

      await this.eventModel.create(
        [
          {
            orderId: order.orderId,
            orderRef: order._id,
            previousStatus,
            status: targetStatus,
            updatedBy: {
              actorRole: OrderActorRole.AGENT,
              actorId: agent._id.toString(),
            },
            timestamp: new Date(),
            note,
            metadata: {
              taskId: task.taskId,
              taskType: task.taskType,
              reason: dto.reason,
              notes: dto.notes?.trim(),
              photoKey,
              geo:
                dto.latitude !== undefined && dto.longitude !== undefined
                  ? {
                      latitude: Number(dto.latitude),
                      longitude: Number(dto.longitude),
                      accuracy: dto.accuracy !== undefined ? Number(dto.accuracy) : 0,
                    }
                  : undefined,
            },
          },
        ],
        { session },
      );

      // D. Publish domain event to Transactional Outbox
      await this.outboxPublisher.publish(
        'ORDER_STATUS_CHANGED',
        {
          orderId: order.orderId,
          orderRef: order._id,
          previousStatus,
          status: targetStatus,
          reason: dto.reason,
          updatedBy: {
            actorRole: OrderActorRole.AGENT,
            actorId: agent._id.toString(),
          },
          timestamp: new Date(),
        },
        session,
      );
    });

    // 9. Generate Signed URL for optional photo preview
    let signedPhotoUrl: string | undefined;
    if (photoKey) {
      try {
        signedPhotoUrl = await this.storageService.getSignedDownloadUrl(photoKey);
      } catch (err: any) {
        this.logger.warn(`Failed to generate signed URL for key '${photoKey}': ${err.message}`);
      }
    }

    return {
      success: true,
      taskId: task.taskId,
      orderId: order.orderId,
      taskType: task.taskType,
      taskStatus: TaskStatus.FAILED,
      orderStatus: targetStatus,
      reason: dto.reason,
      notes: dto.notes?.trim(),
      photoKey,
      signedPhotoUrl,
      timestamp: new Date(),
    };
  }

  /**
   * Retrieves assigned tasks for the authenticated agent.
   * Partitions by route ("today" vs "completed"), and enriches each task with order snapshot
   * customer details (name, phone, address) for quick-dial and route execution.
   * Source of truth: PRD.md §6.12.5 (FR-AGT-1, FR-AGT-2); TECH_STACK.md §4.2; TODO.md TASK-037.
   */
  async getAgentTasks(
    agent: UserDocument,
    query: { partition?: string; status?: string; date?: string } = {},
  ): Promise<any[]> {
    const filter: any = { agentId: agent._id };

    if (query.partition === 'today') {
      filter.status = { $in: [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS] };
      if (query.date) {
        filter.scheduledDate = query.date;
      }
    } else if (query.partition === 'completed') {
      filter.status = { $in: [TaskStatus.COMPLETED, TaskStatus.FAILED] };
    } else if (query.status) {
      filter.status = query.status;
    }

    if (query.date && query.partition !== 'today') {
      filter.scheduledDate = query.date;
    }

    const tasks = await this.deliveryTaskModel
      .find(filter)
      .sort({ scheduledDate: 1, scheduledTimeWindow: 1, createdAt: 1 })
      .lean();

    // Enrich tasks with order snapshot details
    const orderIds = tasks.map((t) => t.orderId);
    const orders = await this.orderModel.find({ orderId: { $in: orderIds } }).lean();
    const orderMap = new Map(orders.map((o) => [o.orderId, o]));

    return tasks.map((task) => {
      const order = orderMap.get(task.orderId) as any;
      const address = order?.addressSnapshot;

      return {
        _id: task._id.toString(),
        taskId: task.taskId,
        orderId: task.orderId,
        taskType: task.taskType,
        status: task.status,
        scheduledDate: task.scheduledDate,
        scheduledTimeWindow: task.scheduledTimeWindow,
        attemptNumber: task.attemptNumber || 1,
        proofId: task.proofId?.toString(),
        failureReason: task.failureReason,
        failureNotes: task.failureNotes,
        customer: {
          name: address?.name || 'Valued Customer',
          phone: address?.contactPhone || address?.phone || '+91 98765 43210',
          street: address?.street || '',
          apartment: address?.apartment || '',
          city: address?.city || 'Mumbai',
          pincode: address?.pincode || '',
          landmark: address?.landmark,
        },
        orderStatus: order?.status,
        itemCount: order?.items?.length || 0,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      };
    });
  }
}
