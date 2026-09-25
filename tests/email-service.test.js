import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import {
  EmailService,
  MockEmailProvider,
  ResendEmailProvider,
  BrevoEmailProvider,
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

  it('BrevoEmailProvider sends via HTTPS API and handles success', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: '<brevo-message-id-123@smtp-relay.mailin.fr>' }),
    });
    globalThis.fetch = mockFetch;

    const provider = new BrevoEmailProvider({ apiKey: 'xkeysib-test-12345', from: 'Rupakar <noreply@rupakar.com>' });
    const result = await provider.send({
      to: 'buyer@example.com',
      subject: 'Order Confirmed',
      html: '<p>Your order is confirmed</p>',
      text: 'Your order is confirmed',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('<brevo-message-id-123@smtp-relay.mailin.fr>');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(options.headers.accept).toBe('application/json');
    expect(options.headers['api-key']).toBe('xkeysib-test-12345');
    expect(options.headers['content-type']).toBe('application/json');
    const parsedBody = JSON.parse(options.body);
    expect(parsedBody.sender).toEqual({ name: 'Rupakar', email: 'noreply@rupakar.com' });
    expect(parsedBody.to).toEqual([{ email: 'buyer@example.com' }]);
    expect(parsedBody.subject).toBe('Order Confirmed');
    expect(parsedBody.htmlContent).toBe('<p>Your order is confirmed</p>');
    expect(parsedBody.textContent).toBe('Your order is confirmed');
  });

  it('BrevoEmailProvider throws descriptive error on API failure', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Key not found' }),
    });

    const provider = new BrevoEmailProvider({ apiKey: 'invalid_key', from: 'noreply@rupakar.com' });
    await expect(provider.send({
      to: 'buyer@example.com',
      subject: 'Test',
      html: '<p>Test</p>',
    })).rejects.toThrow('Email send failed: Key not found');
  });

  it('BrevoEmailProvider fails clearly when API key is missing', async () => {
    const originalKey = env.BREVO_API_KEY;
    try {
      env.BREVO_API_KEY = '';
      const provider = new BrevoEmailProvider({ apiKey: '' });
      await expect(provider.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })).rejects.toThrow('Email send failed: Brevo API key is required');
    } finally {
      env.BREVO_API_KEY = originalKey;
    }
  });

  it('ResendEmailProvider fails clearly when API key is missing', async () => {
    const originalKey = env.RESEND_API_KEY;
    try {
      env.RESEND_API_KEY = '';
      const provider = new ResendEmailProvider({ apiKey: '' });
      await expect(provider.send({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      })).rejects.toThrow('Email send failed: Resend API key is required');
    } finally {
      env.RESEND_API_KEY = originalKey;
    }
  });

  it('EmailService constructor prefers custom provider if passed', async () => {
    const mockProvider = { send: jest.fn().mockResolvedValue({ messageId: 'custom-1', success: true }) };
    const service = new EmailService(mockProvider);
    const res = await service.sendEmail({ to: 'user@example.com', subject: 'Custom' });
    expect(res.messageId).toBe('custom-1');
    expect(mockProvider.send).toHaveBeenCalled();
  });

  it('ResendEmailProvider initializes correctly with explicit config and fallback to env', () => {
    const originalKey = env.RESEND_API_KEY;
    const originalFrom = env.EMAIL_FROM;
    try {
      env.RESEND_API_KEY = 're_env_key_123';
      env.EMAIL_FROM = 'noreply@example.com';

      const providerDefault = new ResendEmailProvider();
      expect(providerDefault.apiKey).toBe('re_env_key_123');
      expect(providerDefault.from).toBe('noreply@example.com');

      const providerExplicit = new ResendEmailProvider({ apiKey: 're_custom_key', from: 'custom@example.com' });
      expect(providerExplicit.apiKey).toBe('re_custom_key');
      expect(providerExplicit.from).toBe('custom@example.com');
    } finally {
      env.RESEND_API_KEY = originalKey;
      env.EMAIL_FROM = originalFrom;
    }
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

  it('EmailService constructor selects BrevoEmailProvider when EMAIL_PROVIDER=brevo', () => {
    const originalProvider = env.EMAIL_PROVIDER;
    const originalKey = env.BREVO_API_KEY;
    try {
      env.EMAIL_PROVIDER = 'brevo';
      env.BREVO_API_KEY = 'xkeysib-test-key';
      const service = new EmailService();
      expect(service.provider).toBeInstanceOf(BrevoEmailProvider);
    } finally {
      env.EMAIL_PROVIDER = originalProvider;
      env.BREVO_API_KEY = originalKey;
    }
  });

  it('selects provider strictly based on EMAIL_PROVIDER even when both Resend and Brevo API keys exist', () => {
    const originalProvider = env.EMAIL_PROVIDER;
    const originalResendKey = env.RESEND_API_KEY;
    const originalBrevoKey = env.BREVO_API_KEY;
    try {
      env.RESEND_API_KEY = 're_key_123';
      env.BREVO_API_KEY = 'xkeysib_key_456';

      env.EMAIL_PROVIDER = 'brevo';
      const brevoService = new EmailService();
      expect(brevoService.provider).toBeInstanceOf(BrevoEmailProvider);

      env.EMAIL_PROVIDER = 'resend';
      const resendService = new EmailService();
      expect(resendService.provider).toBeInstanceOf(ResendEmailProvider);

      env.EMAIL_PROVIDER = 'gmail';
      const gmailService = new EmailService();
      expect(gmailService.provider).toBeInstanceOf(GmailEmailProvider);

      env.EMAIL_PROVIDER = 'smtp';
      const smtpService = new EmailService();
      expect(smtpService.provider).toBeInstanceOf(SmtpEmailProvider);
    } finally {
      env.EMAIL_PROVIDER = originalProvider;
      env.RESEND_API_KEY = originalResendKey;
      env.BREVO_API_KEY = originalBrevoKey;
    }
  });

  it('processes queued email through email worker and delivers via Brevo when EMAIL_PROVIDER=brevo', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ messageId: 'brevo-worker-msg-123' }),
    });
    globalThis.fetch = mockFetch;

    const originalProvider = env.EMAIL_PROVIDER;
    const originalBrevoKey = env.BREVO_API_KEY;
    try {
      env.EMAIL_PROVIDER = 'brevo';
      env.BREVO_API_KEY = 'xkeysib-worker-test';
      const service = new EmailService();

      const jobData = {
        to: 'customer@rupakar.com',
        subject: '654321 is your verification code',
        html: '<p>Code: 654321</p>',
        text: 'Code: 654321',
      };

      const result = await service.sendEmail(jobData);
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('brevo-worker-msg-123');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe('https://api.brevo.com/v3/smtp/email');
      expect(options.headers['api-key']).toBe('xkeysib-worker-test');
      const body = JSON.parse(options.body);
      expect(body.to).toEqual([{ email: 'customer@rupakar.com' }]);
      expect(body.subject).toBe('654321 is your verification code');
    } finally {
      env.EMAIL_PROVIDER = originalProvider;
      env.BREVO_API_KEY = originalBrevoKey;
    }
  });

  it('EmailService constructor selects GmailEmailProvider when configured for Gmail', () => {
    const originalProvider = env.EMAIL_PROVIDER;
    const originalHost = env.EMAIL_HOST;
    const originalUser = env.EMAIL_USER;
    const originalPass = env.EMAIL_PASSWORD;
    try {
      env.EMAIL_PROVIDER = 'gmail';
      env.EMAIL_HOST = 'smtp.gmail.com';
      env.EMAIL_USER = 'test@gmail.com';
      env.EMAIL_PASSWORD = 'password';
      const service = new EmailService();
      expect(service.provider).toBeInstanceOf(GmailEmailProvider);
    } finally {
      env.EMAIL_PROVIDER = originalProvider;
      env.EMAIL_HOST = originalHost;
      env.EMAIL_USER = originalUser;
      env.EMAIL_PASSWORD = originalPass;
    }
  });

  it('EmailService constructor selects SmtpEmailProvider when configured for general SMTP', () => {
    const originalProvider = env.EMAIL_PROVIDER;
    const originalHost = env.EMAIL_HOST;
    const originalUser = env.EMAIL_USER;
    const originalPass = env.EMAIL_PASSWORD;
    try {
      env.EMAIL_PROVIDER = 'smtp';
      env.EMAIL_HOST = 'smtp.sendgrid.net';
      env.EMAIL_USER = 'apikey';
      env.EMAIL_PASSWORD = 'password';
      const service = new EmailService();
      expect(service.provider).toBeInstanceOf(SmtpEmailProvider);
    } finally {
      env.EMAIL_PROVIDER = originalProvider;
      env.EMAIL_HOST = originalHost;
      env.EMAIL_USER = originalUser;
      env.EMAIL_PASSWORD = originalPass;
    }
  });

  it('processes OTP email job through email worker logic and dispatches to configured provider', async () => {
    const mockProvider = { send: jest.fn().mockResolvedValue({ messageId: 'resend-otp-999', success: true }) };
    const service = new EmailService(mockProvider);

    const job = {
      id: 'job-otp-1',
      name: 'send-otp-email',
      data: {
        to: 'customer@rupakar.com',
        subject: '123456 is your Rupakar verification code',
        html: '<p>Your code is 123456</p>',
        text: 'Your code is 123456',
      },
    };

    const result = await service.sendEmail({
      to: job.data.to,
      subject: job.data.subject,
      html: job.data.html,
      text: job.data.text,
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('resend-otp-999');
    expect(mockProvider.send).toHaveBeenCalledWith({
      to: 'customer@rupakar.com',
      subject: '123456 is your Rupakar verification code',
      html: '<p>Your code is 123456</p>',
      text: 'Your code is 123456',
    });
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

  it('GmailEmailProvider resolves port 587 with secure:false and requireTLS:true by default', () => {
    const provider = new GmailEmailProvider();
    expect(provider.port).toBe(587);
    expect(provider.secure).toBe(false);
    expect(provider.host).toBe('smtp.gmail.com');
  });

  it('GmailEmailProvider resolves port 465 with secure:true when configured', () => {
    const provider = new GmailEmailProvider({ port: 465 });
    expect(provider.port).toBe(465);
    expect(provider.secure).toBe(true);
    expect(provider.host).toBe('smtp.gmail.com');
  });

  it('SmtpEmailProvider resolves configured host, port 587, and secure:false', () => {
    const provider = new SmtpEmailProvider({ host: 'smtp.sendgrid.net', port: 587 });
    expect(provider.host).toBe('smtp.sendgrid.net');
    expect(provider.port).toBe(587);
    expect(provider.secure).toBe(false);
  });
});
