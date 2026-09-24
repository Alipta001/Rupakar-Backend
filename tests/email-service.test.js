import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  EmailService,
  MockEmailProvider,
  ResendEmailProvider,
  GmailEmailProvider,
  SmtpEmailProvider,
} from '../app/services/email.service.js';
import { env } from '../app/config/env.js';

describe('EmailService and Providers', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('MockEmailProvider logs and returns success mock object', async () => {
    const provider = new MockEmailProvider();
    const result = await provider.send({
      to: 'customer@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });
    expect(result.success).toBe(true);
    expect(result.messageId).toContain('mock-');
  });

  it('ResendEmailProvider sends via HTTPS API and handles success', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-12345' }),
    });
    globalThis.fetch = mockFetch;

    const provider = new ResendEmailProvider({ apiKey: 're_1234567890', from: 'noreply@rupakar.com' });
    const result = await provider.send({
      to: 'buyer@example.com',
      subject: 'Order Confirmed',
      html: '<p>Your order is confirmed</p>',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('resend-12345');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(options.headers.Authorization).toBe('Bearer re_1234567890');
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.to).toEqual(['buyer@example.com']);
    expect(parsedBody.from).toBe('noreply@rupakar.com');
  });

  it('ResendEmailProvider throws descriptive error on failure', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ message: 'Domain not verified' }),
    });

    const provider = new ResendEmailProvider({ apiKey: 're_invalid', from: 'noreply@rupakar.com' });
    await expect(provider.send({
      to: 'buyer@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    })).rejects.toThrow('Email send failed: Domain not verified');
  });

  it('EmailService constructor prefers custom provider if passed', async () => {
    const mockProvider = { send: jest.fn().mockResolvedValue({ messageId: 'custom-1', success: true }) };
    const service = new EmailService(mockProvider);
    const res = await service.sendEmail({ to: 'user@example.com', subject: 'Custom' });
    expect(res.messageId).toBe('custom-1');
    expect(mockProvider.send).toHaveBeenCalled();
  });

  it('EmailService constructor selects ResendEmailProvider when EMAIL_PROVIDER=resend', () => {
    const originalProvider = env.EMAIL_PROVIDER;
    const originalKey = env.RESEND_API_KEY;
    try {
      env.EMAIL_PROVIDER = 'resend';
      env.RESEND_API_KEY = 're_test_key_123';
      const service = new EmailService();
      expect(service.provider).toBeInstanceOf(ResendEmailProvider);
    } finally {
      env.EMAIL_PROVIDER = originalProvider;
      env.RESEND_API_KEY = originalKey;
    }
  });

  it('sendOtpEmail produces verification email with correct link and OTP', async () => {
    const mockProvider = { send: jest.fn().mockResolvedValue({ messageId: 'otp-1', success: true }) };
    const service = new EmailService(mockProvider);

    await service.sendOtpEmail({ email: 'user@example.com', name: 'Alok', otp: '654321' });

    expect(mockProvider.send).toHaveBeenCalledTimes(1);
    const sentData = mockProvider.send.mock.calls[0][0];
    expect(sentData.to).toBe('user@example.com');
    expect(sentData.subject).toContain('654321');
    expect(sentData.html).toContain('654321');
    expect(sentData.html).toContain('/verify-otp?email=user%40example.com');
  });

  it('sendPasswordResetOtp produces reset email with correct link and OTP', async () => {
    const mockProvider = { send: jest.fn().mockResolvedValue({ messageId: 'reset-1', success: true }) };
    const service = new EmailService(mockProvider);

    await service.sendPasswordResetOtp({ email: 'user@example.com', otp: '112233' });

    expect(mockProvider.send).toHaveBeenCalledTimes(1);
    const sentData = mockProvider.send.mock.calls[0][0];
    expect(sentData.to).toBe('user@example.com');
    expect(sentData.subject).toContain('112233');
    expect(sentData.html).toContain('112233');
    expect(sentData.html).toContain('/reset-password?email=user%40example.com');
  });
});
