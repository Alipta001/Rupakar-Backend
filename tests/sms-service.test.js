import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  SmsService,
  MockSmsProvider,
  TwilioSmsProvider,
  HttpSmsProvider,
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

  describe('HttpSmsProvider', () => {
    it('sends SMS via generic HTTP SMS gateway', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messageId: 'http-sms-999' }),
      });
      globalThis.fetch = mockFetch;

      const provider = new HttpSmsProvider({
        apiUrl: 'https://sms-gateway.example.com/send',
        apiKey: 'secret-api-key',
      });

      const result = await provider.send({
        to: '9876543210',
        message: 'Test notification',
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('http-sms-999');
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://sms-gateway.example.com/send');
      const parsed = JSON.parse(options.body);
      expect(parsed.to).toBe('+919876543210');
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
  });
});
