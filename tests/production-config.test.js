import { execFileSync } from 'node:child_process';
import { expect, it } from '@jest/globals';

const envFor = (overrides = {}) => ({
  ...process.env,
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://staging.example/rupakar',
  REDIS_URL: 'redis://staging.example:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  REDIS_ENABLED: 'true',
  WORKER_ENABLED: 'false',
  PAYMENT_MOCK_ENABLED: 'false',
  CORS_ALLOWED_ORIGINS: 'https://staging.example.com',
  FRONTEND_URL: 'https://staging.example.com',
  EMAIL_HOST: 'smtp.staging.example.com',
  EMAIL_USER: 'staging@example.com',
  EMAIL_PASSWORD: 'staging-password',
  STORAGE_BUCKET: 'rupakar-staging',
  RAZORPAY_KEY_ID: 'rzp_live_production_key',
  RAZORPAY_KEY_SECRET: 'production-secret',
  RAZORPAY_WEBHOOK_SECRET: 'production-webhook-secret',
  ...overrides,
});

const loadEnv = (overrides = {}) => execFileSync(
  process.execPath,
  ['--input-type=module', '-e', "import('./app/config/env.js')"],
  { env: envFor(overrides), encoding: 'utf8', stdio: 'pipe' },
);

const loadDevelopmentEnv = (overrides = {}) => execFileSync(
  process.execPath,
  ['--input-type=module', '-e', "import('./app/config/env.js')"],
  {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      RAZORPAY_KEY_ID: 'rzp_test_development_key',
      RAZORPAY_KEY_SECRET: 'development-test-secret',
      ...overrides,
    },
    encoding: 'utf8',
    stdio: 'pipe',
  },
);

it('accepts complete staging-style production configuration', () => {
  expect(() => loadEnv()).not.toThrow();
});

it('rejects production with Redis disabled', () => {
  expect(() => loadEnv({ REDIS_ENABLED: 'false' })).toThrow();
});

it('rejects production with mock payments enabled', () => {
  expect(() => loadEnv({ PAYMENT_MOCK_ENABLED: 'true' })).toThrow();
});

it('rejects production localhost CORS origins', () => {
  expect(() => loadEnv({ CORS_ALLOWED_ORIGINS: 'http://localhost:3000' })).toThrow();
});

it('rejects placeholder JWT secrets', () => {
  expect(() => loadEnv({ JWT_ACCESS_SECRET: 'change-me-access-secret' })).toThrow();
});

it('accepts a Test Mode key in development', () => {
  expect(() => loadDevelopmentEnv()).not.toThrow();
});

it('rejects a Live Mode key in development', () => {
  expect(() => loadDevelopmentEnv({ RAZORPAY_KEY_ID: 'rzp_live_development_key' })).toThrow();
});

it('rejects a Test Mode key in production', () => {
  expect(() => loadEnv({ RAZORPAY_KEY_ID: 'rzp_test_wrong_environment' })).toThrow();
});

it('accepts production configuration using Brevo API key when SMTP is not set', () => {
  expect(() => loadEnv({
    EMAIL_HOST: '',
    EMAIL_USER: '',
    EMAIL_PASSWORD: '',
    RESEND_API_KEY: '',
    BREVO_API_KEY: 'xkeysib-production-key',
  })).not.toThrow();
});

it('accepts production configuration using Resend API key when SMTP is not set', () => {
  expect(() => loadEnv({
    EMAIL_HOST: '',
    EMAIL_USER: '',
    EMAIL_PASSWORD: '',
    RESEND_API_KEY: 're_production_key',
    BREVO_API_KEY: '',
  })).not.toThrow();
});
