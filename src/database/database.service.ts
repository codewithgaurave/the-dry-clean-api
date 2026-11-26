import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';

export interface DatabaseHealthStatus {
  status: 'ok' | 'error';
  mongo: 'connected' | 'disconnected' | 'connecting';
  latencyMs?: number;
  details?: string;
}

/**
 * Database Service managing MongoDB Replica Set Connection & ACID Transactions.
 * Source of truth: TECH_STACK.md §4.1, §7.1, §8.1.
 */
@Injectable()
export class DatabaseService {
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /**
   * Ping database and check replica set connection health.
   */
  async checkHealth(): Promise<DatabaseHealthStatus> {
    const readyState = this.connection.readyState;
    // 0: disconnected, 1: connected, 2: connecting, 3: disconnecting
    if (readyState !== 1) {
      return {
        status: 'error',
        mongo: readyState === 2 ? 'connecting' : 'disconnected',
        details: `Mongoose connection readyState is ${readyState}`,
      };
    }

    try {
      const start = Date.now();
      if (this.connection.db) {
        await this.connection.db.admin().ping();
      }
      const latencyMs = Date.now() - start;

      return {
        status: 'ok',
        mongo: 'connected',
        latencyMs,
      };
    } catch (error: any) {
      this.logger.error(`Database health ping failed: ${error.message}`, error.stack);
      return {
        status: 'error',
        mongo: 'disconnected',
        details: error.message,
      };
    }
  }

  /**
   * Start a Mongoose ClientSession for multi-document ACID transactions.
   */
  async startSession(): Promise<ClientSession> {
    return this.connection.startSession();
  }

  /**
   * Executes a callback within a managed MongoDB multi-document transaction.
   * Commits on success, automatically aborts and retries on transient errors.
   */
  async withTransaction<T>(
    operation: (session: ClientSession) => Promise<T>,
    maxRetries = 3,
  ): Promise<T> {
    const session = await this.startSession();
    let attempt = 0;

    try {
      while (attempt < maxRetries) {
        attempt++;
        try {
          session.startTransaction({
            readConcern: { level: 'majority' },
            writeConcern: { w: 'majority' },
          });

          const result = await operation(session);
          await session.commitTransaction();
          return result;
        } catch (error: any) {
          if (session.inTransaction()) {
            await session.abortTransaction();
          }

          const isTransient =
            error.hasErrorLabel &&
            (error.hasErrorLabel('TransientTransactionError') ||
              error.hasErrorLabel('UnknownTransactionCommitResult'));

          if (isTransient && attempt < maxRetries) {
            this.logger.warn(
              `Transient transaction error on attempt ${attempt}. Retrying... Reason: ${error.message}`,
            );
            continue;
          }

          this.logger.error(
            `Transaction failed on attempt ${attempt}: ${error.message}`,
            error.stack,
          );
          throw error;
        }
      }

      throw new Error(`Transaction failed after ${maxRetries} attempts.`);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Return the underlying connection.
   */
  getConnection(): Connection {
    return this.connection;
  }
}
