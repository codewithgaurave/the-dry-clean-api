import { Module, Global } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service';
import { User, UserSchema } from './schemas/user.schema';
import { Address, AddressSchema } from './schemas/address.schema';
import { Service, ServiceSchema, ServicePrice, ServicePriceSchema } from './schemas/service.schema';
import { Booking, BookingSchema } from './schemas/booking.schema';
import { Order, OrderSchema } from './schemas/order.schema';
import { OrderStatusEvent, OrderStatusEventSchema } from './schemas/order-status-event.schema';
import { DeliveryTask, DeliveryTaskSchema } from './schemas/delivery-task.schema';
import { OutboxMessage, OutboxMessageSchema } from './schemas/outbox-message.schema';
import { OtpCode, OtpCodeSchema } from './schemas/otp-code.schema';
import { RefreshToken, RefreshTokenSchema } from './schemas/refresh-token.schema';
import { Coupon, CouponSchema } from './schemas/coupon.schema';
import { PickupSlot, PickupSlotSchema } from './schemas/pickup-slot.schema';
import { IdempotencyRecord, IdempotencyRecordSchema } from './schemas/idempotency-record.schema';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { OrderProof, OrderProofSchema } from './schemas/order-proof.schema';

/**
 * Global Database Module providing Mongoose Replica Set Connection & Core Schemas.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri =
          config.get<string>('database.uri') ||
          'mongodb://localhost:27017/the_dry_clean?replicaSet=rs0';

        return {
          uri,
          autoIndex: true,
          connectTimeoutMS: 10000,
          serverSelectionTimeoutMS: 5000,
          retryAttempts: 3,
          retryDelay: 1000,
          maxPoolSize: 20,
          minPoolSize: 5,
        };
      },
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Address.name, schema: AddressSchema },
      { name: Service.name, schema: ServiceSchema },
      { name: ServicePrice.name, schema: ServicePriceSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Order.name, schema: OrderSchema },
      { name: OrderStatusEvent.name, schema: OrderStatusEventSchema },
      { name: DeliveryTask.name, schema: DeliveryTaskSchema },
      { name: OutboxMessage.name, schema: OutboxMessageSchema },
      { name: OtpCode.name, schema: OtpCodeSchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      { name: Coupon.name, schema: CouponSchema },
      { name: PickupSlot.name, schema: PickupSlotSchema },
      { name: IdempotencyRecord.name, schema: IdempotencyRecordSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: OrderProof.name, schema: OrderProofSchema },
    ]),
  ],
  providers: [DatabaseService],
  exports: [MongooseModule, DatabaseService],
})
export class DatabaseModule {}
