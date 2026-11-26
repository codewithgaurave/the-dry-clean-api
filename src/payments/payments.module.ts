import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { Payment, PaymentSchema } from '../database/schemas/payment.schema';
import { Order, OrderSchema } from '../database/schemas/order.schema';
import { User, UserSchema } from '../database/schemas/user.schema';
import {
  OrderStatusEvent,
  OrderStatusEventSchema,
} from '../database/schemas/order-status-event.schema';
import { PAYMENT_GATEWAY_ADAPTER } from './adapters/payment-gateway.adapter';
import { MockPaymentAdapter } from './adapters/mock-payment.adapter';
import { RazorpayPaymentAdapter } from './adapters/razorpay-payment.adapter';

/**
 * Payments Module.
 * Source of truth: PRD.md §6.7; TECH_STACK.md §4.1, §8.4; TODO.md TASK-026.
 */
@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Order.name, schema: OrderSchema },
      { name: User.name, schema: UserSchema },
      { name: OrderStatusEvent.name, schema: OrderStatusEventSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [
    MockPaymentAdapter,
    RazorpayPaymentAdapter,
    {
      provide: PAYMENT_GATEWAY_ADAPTER,
      useFactory: (
        config: ConfigService,
        mockAdapter: MockPaymentAdapter,
        razorpayAdapter: RazorpayPaymentAdapter,
      ) => {
        const adapterType = config.get<string>('payments.adapter') || 'mock';
        if (adapterType.toLowerCase() === 'razorpay') {
          return razorpayAdapter;
        }
        return mockAdapter;
      },
      inject: [ConfigService, MockPaymentAdapter, RazorpayPaymentAdapter],
    },
    PaymentsService,
  ],
  exports: [PaymentsService, PAYMENT_GATEWAY_ADAPTER],
})
export class PaymentsModule {}
