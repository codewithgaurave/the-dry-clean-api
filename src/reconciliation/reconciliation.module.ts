import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import { OrderProof, OrderProofSchema } from '../database/schemas/order-proof.schema';
import { SecurityAudit, SecurityAuditSchema } from '../database/schemas/security-audit.schema';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationController } from './reconciliation.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: OrderProof.name, schema: OrderProofSchema },
      { name: SecurityAudit.name, schema: SecurityAuditSchema },
    ]),
  ],
  controllers: [ReconciliationController],
  providers: [ReconciliationService],
  exports: [ReconciliationService],
})
export class ReconciliationModule {}
