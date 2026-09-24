import { env } from '../config/env.js';

export function normalizePhoneNumber(phone) {
  if (!phone) return '';
  const cleaned = String(phone).trim();
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  if (cleaned.startsWith('+')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

export function maskPhoneNumber(phone) {
  if (!phone) return 'unknown';
  const str = String(phone).trim();
  if (str.length <= 4) return '****';
  return str.slice(0, 3) + '*'.repeat(Math.max(0, str.length - 7)) + str.slice(-4);
}

export class MockSmsProvider {
  async send({ to, message }) {
    console.log(`[MOCK SMS] To: ${maskPhoneNumber(to)}, Message length: ${message?.length ?? 0}`);
    return { messageId: `mock-sms-${Date.now()}`, success: true };
  }
}

export class TwilioSmsProvider {
  constructor({ accountSid, authToken, fromNumber } = {}) {
    this.accountSid = accountSid || env.TWILIO_ACCOUNT_SID;
    this.authToken = authToken || env.TWILIO_AUTH_TOKEN;
    this.fromNumber = fromNumber || env.TWILIO_PHONE_NUMBER;
  }

  async send({ to, message }) {
    const normalizedTo = normalizePhoneNumber(to);
    if (!normalizedTo) throw new Error('Invalid recipient phone number');

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Messages.json`;
    const credentials = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

    const body = new URLSearchParams({
      To: normalizedTo,
      From: this.fromNumber,
      Body: message,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[SMS ERROR: TWILIO] Failed to send SMS to ${maskPhoneNumber(normalizedTo)}: ${data.message || data.error_message || response.statusText}`);
      throw new Error(`Twilio SMS error (${response.status}): ${data.message || data.error_message || 'Failed to send SMS'}`);
    }

    return { messageId: data.sid || `twilio-${Date.now()}`, success: true };
  }
}

export class HttpSmsProvider {
  constructor({ apiUrl, apiKey } = {}) {
    this.apiUrl = apiUrl || env.SMS_API_URL;
    this.apiKey = apiKey || env.SMS_API_KEY;
  }

  async send({ to, message }) {
    const normalizedTo = normalizePhoneNumber(to);
    if (!normalizedTo) throw new Error('Invalid recipient phone number');

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ to: normalizedTo, message }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error(`[SMS ERROR: HTTP] Failed to send SMS to ${maskPhoneNumber(normalizedTo)}`);
      throw new Error(`SMS gateway error (${response.status})`);
    }

    return { messageId: data.messageId || data.id || `sms-${Date.now()}`, success: true };
  }
}

export class SmsService {
  constructor(provider) {
    if (provider) {
      this.provider = provider;
      return;
    }

    const hasTwilioCredentials = Boolean(
      env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_PHONE_NUMBER &&
      !env.TWILIO_ACCOUNT_SID.includes('placeholder')
    );

    const hasHttpSms = Boolean(env.SMS_API_URL && env.SMS_API_KEY);

    if (env.SMS_PROVIDER === 'twilio' && hasTwilioCredentials) {
      this.provider = new TwilioSmsProvider();
    } else if (hasHttpSms) {
      this.provider = new HttpSmsProvider();
    } else if (hasTwilioCredentials) {
      this.provider = new TwilioSmsProvider();
    } else {
      this.provider = new MockSmsProvider();
    }
  }

  async sendSms({ to, message }) {
    if (!to || !message) throw new Error('SMS recipient and message are required');
    if (env.SMS_PROVIDER === 'none') return { success: false, skipped: true };

    const normalizedTo = normalizePhoneNumber(to);
    return this.provider.send({ to: normalizedTo, message });
  }
}

export const smsService = new SmsService();