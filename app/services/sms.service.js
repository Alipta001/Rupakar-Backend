import { env } from '../config/env.js';

class MockSmsProvider {
  async send({ to, message }) {
    console.log(`[MOCK SMS] To: ${to}, Message: ${message}`);
    return { messageId: `mock-sms-${Date.now()}`, success: true };
  }
}

class SmsService {
  constructor() {
    this.provider = new MockSmsProvider();
  }

  async sendSms({ to, message }) {
    if (!to || !message) throw new Error('SMS recipient and message are required');
    if (env.SMS_PROVIDER === 'none') return { success: false, skipped: true };
    return this.provider.send({ to, message });
  }
}

export const smsService = new SmsService();