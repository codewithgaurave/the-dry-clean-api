import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DeliveryTask, DeliveryTaskSchema } from '../database/schemas/delivery-task.schema';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import { OrderProof, OrderProofSchema } from '../database/schemas/order-proof.schema';
import {
  OrderStatusEvent,
  OrderStatusEventSchema,
} from '../database/schemas/order-status-event.schema';
import { StorageModule } from '../storage/storage.module';
import { OrdersModule } from '../orders/orders.module';
import { OutboxModule } from '../outbox/outbox.module';
import { AgentTasksController } from './agent-tasks.controller';
import { AgentTasksService } from './agent-tasks.service';

/**
 * AgentModule:
 * Manages agent operations, task fulfillment, and proof verification engine.
 * Source of truth: PRD.md §6.12.1, §6.12.2; TECH_STACK.md §9.4; TODO.md TASK-035.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DeliveryTask.name, schema: DeliveryTaskSchema },
      { name: Order.name, schema: OrderSchema },
      { name: OrderProof.name, schema: OrderProofSchema },
      { name: OrderStatusEvent.name, schema: OrderStatusEventSchema },
    ]),
    StorageModule,
    OrdersModule,
    OutboxModule,
  ],
  controllers: [AgentTasksController],
  providers: [AgentTasksService],
  exports: [AgentTasksService],
})
export class AgentModule {}
