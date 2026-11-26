export const SMS_ADAPTER = 'SMS_ADAPTER';

export interface ISmsAdapter {
  sendOtp(phone: string, otp: string): Promise<boolean>;
}
