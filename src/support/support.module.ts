import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { SupportTicket, SupportTicketSchema } from '../database/schemas/support-ticket.schema';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: SupportTicket.name, schema: SupportTicketSchema },
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
