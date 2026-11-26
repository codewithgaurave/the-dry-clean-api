import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  OutboxMessage,
  OutboxMessageDocument,
  OutboxStatus,
} from '../database/schemas/outbox-message.schema';

export type OutboxEventHandler = (payload: any) => Promise<void>;

/**
 * Background Polling Worker Service.
 * Polls pending outbox records, dispatches to event handlers, and guarantees at-least-once delivery.
 * Source of truth: TECH_STACK.md §4.1, §7.5; TODO.md TASK-011.
 */
@Injectable()
export class OutboxWorkerService {
  private readonly logger = new Logger(OutboxWorkerService.name);
  private readonly handlers = new Map<string, OutboxEventHandler>();
  private isPolling = false;
  private isWorkerEnabled = true;

  constructor(
    @InjectModel(OutboxMessage.name)
    private readonly outboxModel: Model<OutboxMessageDocument>,
  ) {}

  /**
   * Register a domain event handler.
   */
  registerHandler(eventType: string, handler: OutboxEventHandler): void {
    this.handlers.set(eventType, handler);
    this.logger.log(`Registered handler for outbox event: '${eventType}'`);
  }

  /**
   * Enable or disable the automated interval polling.
   */
  setWorkerEnabled(enabled: boolean): void {
    this.isWorkerEnabled = enabled;
  }

  /**
   * Scheduled interval worker polling for pending messages every 2 seconds.
   */
  @Interval(2000)
  async pollAndProcess(): Promise<void> {
    if (!this.isWorkerEnabled || this.isPolling) {
      return;
    }

    this.isPolling = true;
    try {
      await this.processNextBatch(10);
    } catch (err: any) {
      this.logger.error(`Error during outbox polling tick: ${err.message}`, err.stack);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Atomically claims and processes the next batch of pending outbox messages.
   * Uses findOneAndUpdate to prevent race conditions across parallel instances.
   */
  async processNextBatch(batchSize = 10): Promise<number> {
    let processedCount = 0;

    for (let i = 0; i < batchSize; i++) {
      // Atomically claim the oldest pending record
      const message = await this.outboxModel.findOneAndUpdate(
        { status: OutboxStatus.PENDING },
        { $set: { status: OutboxStatus.PROCESSING } },
        { sort: { createdAt: 1 }, new: true },
      );

      if (!message) {
        break; // No more pending messages in queue
      }

      await this.dispatchMessage(message);
      processedCount++;
    }

    return processedCount;
  }

  /**
   * Dispatches an individual claimed message to registered handlers and records completion.
   */
  private async dispatchMessage(message: OutboxMessageDocument): Promise<void> {
    const handler = this.handlers.get(message.eventType);

    try {
      if (handler) {
        await handler(message.payload);
      } else {
        this.logger.debug(
          `No explicit handler registered for '${message.eventType}'. Acknowledging as processed.`,
        );
      }

      // Mark message successfully processed
      await this.outboxModel.updateOne(
        { _id: message._id },
        {
          $set: {
            status: OutboxStatus.PROCESSED,
            processedAt: new Date(),
          },
        },
      );

      this.logger.log(
        `✓ Outbox message '${message.eventType}' (${message._id}) processed successfully`,
      );
    } catch (error: any) {
      const nextRetryCount = message.retryCount + 1;
      const isFailed = nextRetryCount >= message.maxRetries;

      this.logger.warn(
        `Failed processing outbox message '${message.eventType}' (${message._id}) on attempt ${nextRetryCount}/${message.maxRetries}: ${error.message}`,
      );

      await this.outboxModel.updateOne(
        { _id: message._id },
        {
          $set: {
            status: isFailed ? OutboxStatus.FAILED : OutboxStatus.PENDING,
            retryCount: nextRetryCount,
            lastError: error.message,
          },
        },
      );
    }
  }
}
