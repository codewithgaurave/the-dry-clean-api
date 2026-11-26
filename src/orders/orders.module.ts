import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import {
  OrderStatusEvent,
  OrderStatusEventSchema,
} from '../database/schemas/order-status-event.schema';
import { DeliveryTask, DeliveryTaskSchema } from '../database/schemas/delivery-task.schema';
import { OrderProof, OrderProofSchema } from '../database/schemas/order-proof.schema';
import { SupportTicket, SupportTicketSchema } from '../database/schemas/support-ticket.schema';
import { User, UserSchema } from '../database/schemas/user.schema';
import { OutboxModule } from '../outbox/outbox.module';
import { StorageModule } from '../storage/storage.module';
import { OrderStateMachineService } from './order-state-machine.service';
import { OrderTransitionService } from './order-transition.service';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { AdminProofsController } from './admin-proofs.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: OrderStatusEvent.name, schema: OrderStatusEventSchema },
      { name: DeliveryTask.name, schema: DeliveryTaskSchema },
      { name: OrderProof.name, schema: OrderProofSchema },
      { name: SupportTicket.name, schema: SupportTicketSchema },
      { name: User.name, schema: UserSchema },
    ]),
    OutboxModule,
    StorageModule,
  ],
  controllers: [OrdersController, AdminOrdersController, AdminProofsController],
  providers: [OrderStateMachineService, OrderTransitionService, OrdersService],
  exports: [OrderStateMachineService, OrderTransitionService, OrdersService, MongooseModule],
})
export class OrdersModule {}
