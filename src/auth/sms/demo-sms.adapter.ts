import { Injectable, Logger } from '@nestjs/common';
import { ISmsAdapter } from './sms-adapter.interface';

/**
 * Deterministic Demo SMS Adapter for development, staging, and prototype environments.
 * Source of truth: TECH_STACK.md §4.1; TODO.md TASK-012.
 */
@Injectable()
export class DemoSmsAdapter implements ISmsAdapter {
  private readonly logger = new Logger(DemoSmsAdapter.name);

  async sendOtp(phone: string, otp: string): Promise<boolean> {
    this.logger.log(`📱 [DEMO SMS ADAPTER] Sending OTP to ${phone}: ${otp}`);
    return true;
  }
}
