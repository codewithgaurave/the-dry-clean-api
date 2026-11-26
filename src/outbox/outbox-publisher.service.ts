import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession } from 'mongoose';
import {
  OutboxMessage,
  OutboxMessageDocument,
  OutboxStatus,
} from '../database/schemas/outbox-message.schema';

/**
 * Transactional Outbox Publisher Helper.
 * Writes domain events atomically within the caller's MongoDB transaction.
 * Source of truth: TECH_STACK.md §4.1, §7.5; TODO.md TASK-011.
 */
@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    @InjectModel(OutboxMessage.name)
    private readonly outboxModel: Model<OutboxMessageDocument>,
  ) {}

  /**
   * Publishes an event to the Outbox collection.
   * If session is provided, the message is written within that MongoDB transaction.
   */
  async publish<T extends Record<string, any>>(
    eventType: string,
    payload: T,
    session?: ClientSession,
  ): Promise<OutboxMessageDocument> {
    const messageDoc = new this.outboxModel({
      eventType,
      payload,
      status: OutboxStatus.PENDING,
      retryCount: 0,
      createdAt: new Date(),
    });

    const [saved] = await this.outboxModel.create([messageDoc.toObject()], {
      session,
    });

    this.logger.debug(
      `Outbox message '${eventType}' enqueued with ID: ${saved._id}${
        session ? ' (in active transaction)' : ''
      }`,
    );

    return saved;
  }
}
