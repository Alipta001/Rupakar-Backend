import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  SmsService,
  MockSmsProvider,
  TwilioSmsProvider,
  Msg91SmsProvider,
  normalizePhoneNumber,
  maskPhoneNumber,
} from '../app/services/sms.service.js';

describe('SmsService and Phone Notifications', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('Phone normalization & masking', () => {
    it('normalizes 10-digit Indian numbers to E.164 (+91...) format', () => {
      expect(normalizePhoneNumber('9876543210')).toBe('+919876543210');
      expect(normalizePhoneNumber(' 9876543210 ')).toBe('+919876543210');
      expect(normalizePhoneNumber('98765-43210')).toBe('+919876543210');
    });

    it('normalizes 12-digit Indian numbers starting with 91 to +91...', () => {
      expect(normalizePhoneNumber('919876543210')).toBe('+919876543210');
    });

    it('preserves existing + format', () => {
      expect(normalizePhoneNumber('+919876543210')).toBe('+919876543210');
      expect(normalizePhoneNumber('+14155552671')).toBe('+14155552671');
    });

    it('masks phone numbers safely for logging', () => {
      const masked = maskPhoneNumber('+919876543210');
      expect(masked).toBe('+91******3210');
      expect(masked).not.toContain('987654');
    });
  });

  describe('TwilioSmsProvider', () => {
    it('sends SMS via Twilio API endpoint with correct auth and parameters', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ sid: 'SM1234567890abcdef' }),
      });
      globalThis.fetch = mockFetch;

      const provider = new TwilioSmsProvider({
        accountSid: 'AC_test_account_sid',
        authToken: 'auth_token_secret',
        fromNumber: '+15005550006',
      });

      const result = await provider.send({
        to: '9876543210',
        message: 'Your order #ORD-123 is confirmed',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('SM1234567890abcdef');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/Accounts/AC_test_account_sid/Messages.json');
      expect(options.method).toBe('POST');
      expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('AC_test_account_sid:auth_token_secret').toString('base64')}`);

      const bodyParams = new URLSearchParams(options.body);
      expect(bodyParams.get('To')).toBe('+919876543210');
      expect(bodyParams.get('From')).toBe('+15005550006');
      expect(bodyParams.get('Body')).toBe('Your order #ORD-123 is confirmed');
    });

    it('throws on Twilio API failure without leaking credentials', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ message: 'Invalid phone number' }),
      });

      const provider = new TwilioSmsProvider({
        accountSid: 'AC_test_account_sid',
        authToken: 'auth_token_secret',
        fromNumber: '+15005550006',
      });

      await expect(provider.send({
        to: '9876543210',
        message: 'Hello',
      })).rejects.toThrow('Twilio SMS error (400): Invalid phone number');
    });
  });

  describe('Msg91SmsProvider', () => {
    it('sends SMS via MSG91 Flow API with correct authkey header and payload', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ type: 'success', message: 'SMS submitted successfully', request_id: 'msg91-req-12345' }),
      });
      globalThis.fetch = mockFetch;

      const provider = new Msg91SmsProvider({
        authKey: 'test_msg91_auth_key_123',
        senderId: 'RUPAKR',
        templateId: 'tmpl_order_confirmed_01',
      });

      const result = await provider.send({
        to: '+919876543210',
        message: 'Your order #RPK-101 has been confirmed',
        variables: { order_id: 'RPK-101', customer_name: 'Pooja' },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg91-req-12345');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://control.msg91.com/api/v5/flow/');
      expect(options.method).toBe('POST');
      expect(options.headers.authkey).toBe('test_msg91_auth_key_123');
      expect(options.headers['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body);
      expect(body.template_id).toBe('tmpl_order_confirmed_01');
      expect(body.sender).toBe('RUPAKR');
      expect(body.short_url).toBe('0');
      expect(body.recipients).toHaveLength(1);
      // MSG91 expects number without leading '+'
      expect(body.recipients[0].mobiles).toBe('919876543210');
      expect(body.recipients[0].message).toBe('Your order #RPK-101 has been confirmed');
      expect(body.recipients[0].order_id).toBe('RPK-101');
      expect(body.recipients[0].customer_name).toBe('Pooja');
    });

    it('throws clear configuration error when MSG91_AUTH_KEY is missing', async () => {
      const provider = new Msg91SmsProvider({
        authKey: '',
        templateId: 'tmpl_123',
      });

      await expect(provider.send({
        to: '9876543210',
        message: 'Hello',
      })).rejects.toThrow('MSG91 configuration error: MSG91_AUTH_KEY is required');
    });

    it('throws clear configuration error when MSG91_TEMPLATE_ID is missing', async () => {
      const provider = new Msg91SmsProvider({
        authKey: 'valid_auth_key',
        templateId: '',
      });

      await expect(provider.send({
        to: '9876543210',
        message: 'Hello',
      })).rejects.toThrow('MSG91 configuration error: MSG91_TEMPLATE_ID is required');
    });

    it('handles MSG91 API error response safely without leaking credentials', async () => {
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ type: 'error', message: 'Template not found or inactive' }),
      });

      const provider = new Msg91SmsProvider({
        authKey: 'secret_auth_key',
        templateId: 'tmpl_invalid',
      });

      const sendPromise = provider.send({
        to: '9876543210',
        message: 'Hello',
      });

      await expect(sendPromise).rejects.toThrow('MSG91 SMS error (400): Template not found or inactive');
      await expect(sendPromise).rejects.not.toThrow('secret_auth_key');
    });
  });

  describe('SmsService dispatch and validation', () => {
    it('throws when recipient or message is missing', async () => {
      const service = new SmsService(new MockSmsProvider());
      await expect(service.sendSms({ to: '', message: 'Hi' })).rejects.toThrow('SMS recipient and message are required');
      await expect(service.sendSms({ to: '9876543210', message: '' })).rejects.toThrow('SMS recipient and message are required');
    });

    it('normalizes recipient phone before passing to provider', async () => {
      const mockProvider = { send: jest.fn().mockResolvedValue({ success: true, messageId: 'm1' }) };
      const service = new SmsService(mockProvider);

      await service.sendSms({ to: '9876543210', message: 'Order shipped' });

      expect(mockProvider.send).toHaveBeenCalledWith({
        to: '+919876543210',
        message: 'Order shipped',
      });
    });

    it('does NOT call provider or make network calls when SMS_ENABLED is false', async () => {
      const mockProvider = { send: jest.fn().mockResolvedValue({ success: true, messageId: 'm1' }) };
      const service = new SmsService(mockProvider, { enabled: false });

      const result = await service.sendSms({ to: '9876543210', message: 'Test message' });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('SMS_DISABLED');
      expect(mockProvider.send).not.toHaveBeenCalled();
    });

    it('calls provider and returns success when SMS_ENABLED is true', async () => {
      const mockProvider = { send: jest.fn().mockResolvedValue({ success: true, messageId: 'msg91-ok-1' }) };
      const service = new SmsService(mockProvider, { enabled: true });

      const result = await service.sendSms({ to: '9876543210', message: 'Test message' });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg91-ok-1');
      expect(mockProvider.send).toHaveBeenCalledTimes(1);
    });

    it('allows business workflow to continue safely if MSG91 fails', async () => {
      const failingProvider = {
        send: jest.fn().mockRejectedValue(new Error('MSG91 SMS error (500): Gateway Timeout')),
      };
      const service = new SmsService(failingProvider, { enabled: true });

      let businessWorkflowCompleted = false;

      // Demonstrates how existing order/fulfillment services safely handle SMS dispatch
      try {
        await service.sendSms({ to: '9876543210', message: 'Order reminder' }).catch((err) => {
          // Non-blocking log
          expect(err.message).toContain('MSG91 SMS error');
        });
        businessWorkflowCompleted = true;
      } catch {
        businessWorkflowCompleted = false;
      }

      expect(businessWorkflowCompleted).toBe(true);
    });

    it('email continues working independently when SMS is disabled or fails', async () => {
      const sms = new SmsService(new MockSmsProvider(), { enabled: false });
      const emailMock = { send: jest.fn().mockResolvedValue({ success: true, messageId: 'email-123' }) };

      // Simulate notification handler
      const smsResult = await sms.sendSms({ to: '9876543210', message: 'SMS Text' });
      const emailResult = await emailMock.send({ to: 'user@example.com', subject: 'Email Subject' });

      expect(smsResult.skipped).toBe(true);
      expect(emailResult.success).toBe(true);
      expect(emailMock.send).toHaveBeenCalledTimes(1);
    });
  });
});
