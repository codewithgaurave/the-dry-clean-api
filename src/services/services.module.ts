import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  Service,
  ServiceSchema,
  ServicePrice,
  ServicePriceSchema,
} from '../database/schemas/service.schema';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';

/**
 * Services Module.
 * Source of truth: PRD.md §6.3; TODO.md TASK-017.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Service.name, schema: ServiceSchema },
      { name: ServicePrice.name, schema: ServicePriceSchema },
    ]),
  ],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}
