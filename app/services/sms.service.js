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

export class Msg91SmsProvider {
  constructor({ authKey, senderId, templateId, apiUrl } = {}) {
    this.authKey = authKey || env.MSG91_AUTH_KEY;
    this.senderId = senderId || env.MSG91_SENDER_ID;
    this.templateId = templateId || env.MSG91_TEMPLATE_ID;
    this.apiUrl = apiUrl || env.MSG91_API_URL || 'https://control.msg91.com/api/v5/flow/';
  }

  async send({ to, message, variables = {}, templateId = null }) {
    if (!this.authKey) {
      throw new Error('MSG91 configuration error: MSG91_AUTH_KEY is required');
    }

    const normalizedTo = normalizePhoneNumber(to);
    if (!normalizedTo) throw new Error('Invalid recipient phone number');

    const cleanMobile = normalizedTo.replace(/^\+/, '');
    const resolvedTemplateId = templateId || this.templateId;
    if (!resolvedTemplateId) {
      throw new Error('MSG91 configuration error: MSG91_TEMPLATE_ID is required');
    }

    const recipient = {
      mobiles: cleanMobile,
      message,
      ...(variables && typeof variables === 'object' ? variables : {}),
    };

    const payload = {
      template_id: resolvedTemplateId,
      short_url: '0',
      recipients: [recipient],
    };

    if (this.senderId) {
      payload.sender = this.senderId;
    }

    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        authkey: this.authKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.type === 'error') {
      const errorMsg = data.message || response.statusText || 'Failed to send SMS via MSG91';
      console.error(`[SMS ERROR: MSG91] Failed to send SMS to ${maskPhoneNumber(normalizedTo)}: ${errorMsg}`);
      throw new Error(`MSG91 SMS error (${response.status}): ${errorMsg}`);
    }

    return {
      messageId: data.request_id || data.message || `msg91-${Date.now()}`,
      success: true,
    };
  }
}

export class SmsService {
  constructor(provider, { enabled } = {}) {
    this.enabled = typeof enabled === 'boolean' ? enabled : (provider ? true : env.SMS_ENABLED);
    if (provider) {
      this.provider = provider;
      return;
    }

    const hasMsg91Credentials = Boolean(
      env.MSG91_AUTH_KEY &&
      !env.MSG91_AUTH_KEY.includes('placeholder')
    );

    const hasTwilioCredentials = Boolean(
      env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_PHONE_NUMBER &&
      !env.TWILIO_ACCOUNT_SID.includes('placeholder')
    );

    const hasHttpSms = Boolean(env.SMS_API_URL && env.SMS_API_KEY);

    if (env.SMS_PROVIDER === 'msg91') {
      this.provider = new Msg91SmsProvider();
    } else if (env.SMS_PROVIDER === 'twilio' && hasTwilioCredentials) {
      this.provider = new TwilioSmsProvider();
    } else if (env.SMS_PROVIDER === 'http' && hasHttpSms) {
      this.provider = new HttpSmsProvider();
    } else if (hasMsg91Credentials) {
      this.provider = new Msg91SmsProvider();
    } else if (hasTwilioCredentials) {
      this.provider = new TwilioSmsProvider();
    } else if (hasHttpSms) {
      this.provider = new HttpSmsProvider();
    } else {
      this.provider = new MockSmsProvider();
    }
  }

  async sendSms({ to, message, variables = {}, templateId = null }) {
    if (!to || !message) throw new Error('SMS recipient and message are required');
    if (!this.enabled || env.SMS_PROVIDER === 'none') {
      return { success: false, skipped: true, reason: 'SMS_DISABLED' };
    }

    const normalizedTo = normalizePhoneNumber(to);
    const sendPayload = { to: normalizedTo, message };
    if (templateId) sendPayload.templateId = templateId;
    if (variables && Object.keys(variables).length > 0) sendPayload.variables = variables;

    return this.provider.send(sendPayload);
  }
}

export const smsService = new SmsService();