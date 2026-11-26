import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { OrdersModule } from './orders/orders.module';
import { OutboxModule } from './outbox/outbox.module';
import { AuthModule } from './auth/auth.module';
import { AddressesModule } from './addresses/addresses.module';
import { ProfileModule } from './profile/profile.module';
import { ServicesModule } from './services/services.module';
import { PricingModule } from './pricing/pricing.module';
import { SlotsModule } from './slots/slots.module';
import { CouponsModule } from './coupons/coupons.module';
import { BookingsModule } from './bookings/bookings.module';
import { PaymentsModule } from './payments/payments.module';
import { StorageModule } from './storage/storage.module';
import { AgentModule } from './agent/agent.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ScheduleModule } from '@nestjs/schedule';
import { SupportModule } from './support/support.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.example'],
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    OutboxModule,
    OrdersModule,
    AuthModule,
    AddressesModule,
    ProfileModule,
    ServicesModule,
    PricingModule,
    SlotsModule,
    CouponsModule,
    BookingsModule,
    PaymentsModule,
    StorageModule,
    AgentModule,
    NotificationsModule,
    SupportModule,
    ReconciliationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
