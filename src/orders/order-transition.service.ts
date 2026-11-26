import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DatabaseService } from '../database/database.service';
import { Order, OrderDocument } from '../database/schemas/order.schema';
import {
  OrderStatusEvent,
  OrderStatusEventDocument,
} from '../database/schemas/order-status-event.schema';
import { OutboxPublisherService } from '../outbox/outbox-publisher.service';
import { OrderStateMachineService, TransitionContext } from './order-state-machine.service';
import { OrderStatus } from './order-status.enum';

export interface OrderTransitionResult {
  order: OrderDocument;
  event: OrderStatusEventDocument;
}

/**
 * Transactional Order Status Transition Service.
 * Atomically updates Order state, appends immutable OrderStatusEvent,
 * and enqueues domain events into the transactional Outbox within the same ACID transaction.
 * Source of truth: PRD.md §8.5, §9.1; TECH_STACK.md §4.1, §7.2, §7.5; TODO.md TASK-010, TASK-011.
 */
@Injectable()
export class OrderTransitionService {
  private readonly logger = new Logger(OrderTransitionService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(OrderStatusEvent.name)
    private readonly eventModel: Model<OrderStatusEventDocument>,
    private readonly stateMachine: OrderStateMachineService,
    private readonly databaseService: DatabaseService,
    private readonly outboxPublisher: OutboxPublisherService,
  ) {}

  /**
   * Atomically transitions an order to a target state, validates business rules,
   * updates the order record, logs an immutable audit event, and registers the outbox event
   * in the same session.
   */
  async transitionOrderStatus(
    orderId: string,
    targetStatus: OrderStatus,
    context: TransitionContext,
  ): Promise<OrderTransitionResult> {
    return this.databaseService.withTransaction(async (session) => {
      // 1. Fetch current order within the transaction session
      const order = await this.orderModel.findOne({ orderId }).session(session);
      if (!order) {
        throw new NotFoundException(`Order with ID '${orderId}' not found.`);
      }

      const previousStatus = order.status;

      // 2. Validate state machine transition & proof rules (PRD.md §8.3, §6.12.1)
      this.stateMachine.validateTransition(previousStatus, targetStatus, context);

      // 3. Apply state transition & associate proof reference if applicable
      order.status = targetStatus;
      if (context.proofId && Types.ObjectId.isValid(context.proofId)) {
        if (targetStatus === OrderStatus.PICKED_UP) {
          order.pickupProofId = new Types.ObjectId(context.proofId);
        } else if (targetStatus === OrderStatus.DELIVERED) {
          order.deliveryProofId = new Types.ObjectId(context.proofId);
        }
      }

      const updatedOrder = await order.save({ session });

      // 4. Concurrently append immutable audit status event within the SAME session
      const [event] = await this.eventModel.create(
        [
          {
            orderId: order.orderId,
            orderRef: order._id,
            previousStatus,
            status: targetStatus,
            updatedBy: {
              actorRole: context.actorRole,
              actorId: context.actorId,
            },
            timestamp: new Date(),
            note: context.note,
            proofId: context.proofId,
          },
        ],
        { session },
      );

      // 5. Concurrently write domain event into the Transactional Outbox (TASK-011)
      await this.outboxPublisher.publish(
        'ORDER_STATUS_CHANGED',
        {
          orderId: order.orderId,
          orderRef: order._id,
          previousStatus,
          status: targetStatus,
          updatedBy: {
            actorRole: context.actorRole,
            actorId: context.actorId,
          },
          timestamp: new Date(),
          proofId: context.proofId,
          note: context.note,
        },
        session,
      );

      this.logger.log(
        `Order '${orderId}' transitioned from ${previousStatus} -> ${targetStatus} by ${context.actorRole} (${context.actorId}) [Outbox enqueued]`,
      );

      return {
        order: updatedOrder,
        event,
      };
    });
  }

  /**
   * Retrieve complete immutable status timeline for an order (PRD.md §8.5, FR-TRK-1).
   */
  async getOrderEventHistory(orderId: string): Promise<OrderStatusEventDocument[]> {
    return this.eventModel.find({ orderId }).sort({ timestamp: 1 }).exec();
  }
}
