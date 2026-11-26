import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { OutboxMessage, OutboxMessageSchema } from '../database/schemas/outbox-message.schema';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxWorkerService } from './outbox-worker.service';

@Global()
@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([{ name: OutboxMessage.name, schema: OutboxMessageSchema }]),
  ],
  providers: [OutboxPublisherService, OutboxWorkerService],
  exports: [OutboxPublisherService, OutboxWorkerService],
})
export class OutboxModule {}
