import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = ['development', 'local'].includes(process.env.NODE_ENV ?? 'development');
const productionSecretNames = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const hasPlaceholder = (value) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) return true;
  return /change-me|dev-(access|refresh)-secret|^<.*>$|placeholder|localhost(:\d+)?$/i.test(normalized);
};
const hasRealDeliveryConfig = (url, token) => {
  const normalizedUrl = String(url ?? '').trim();
  const normalizedToken = String(token ?? '').trim();
  return Boolean(normalizedUrl && normalizedToken && !/^<.*>$/.test(normalizedUrl) && !/^<.*>$/.test(normalizedToken) && !/placeholder|example/i.test(normalizedUrl) && !/placeholder|example/i.test(normalizedToken));
};
const durationToMs = (value, fallback) => {
  const match = String(value ?? '').trim().match(/^(\d+)([smhd])$/i);
  if (!match) return fallback;
  return Number(match[1]) * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()]);
};

if (isProduction) {
  const hasResend = Boolean(process.env.RESEND_API_KEY && !hasPlaceholder(process.env.RESEND_API_KEY));
  const hasBrevo = Boolean(process.env.BREVO_API_KEY && !hasPlaceholder(process.env.BREVO_API_KEY));
  const hasSmtp = Boolean(!hasPlaceholder(process.env.EMAIL_HOST) && !hasPlaceholder(process.env.EMAIL_USER) && !hasPlaceholder(process.env.EMAIL_PASSWORD));

  const missing = [
    'MONGODB_URI',
    'REDIS_URL',
    'FRONTEND_URL',
    'CORS_ALLOWED_ORIGINS',
    'STORAGE_BUCKET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    ...productionSecretNames,
  ].filter((name) => hasPlaceholder(process.env[name]));

  if (!hasResend && !hasBrevo && !hasSmtp) {
    missing.push('EMAIL_HOST, EMAIL_USER, EMAIL_PASSWORD (or RESEND_API_KEY or BREVO_API_KEY)');
  }

  if (missing.length > 0) {
    throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  }
  if (process.env.REDIS_ENABLED !== 'true') {
    throw new Error('REDIS_ENABLED=true is required in production');
  }
  if (process.env.STORAGE_PROVIDER === 's3') {
    const missingStorage = ['S3_BUCKET_NAME', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((name) => !process.env[name]);
    if (missingStorage.length > 0) throw new Error(`Missing S3 storage configuration: ${missingStorage.join(', ')}`);
  }
  if (!/^https:\/\//.test(process.env.FRONTEND_URL) || process.env.CORS_ALLOWED_ORIGINS.split(',').some((origin) => !/^https:\/\//.test(origin.trim()) || /localhost|127\.0\.0\.1/.test(origin))) {
    throw new Error('Production frontend and CORS origins must use HTTPS');
  }
}

if (isDevelopment && (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_'))) {
  throw new Error('Development Razorpay configuration requires an rzp_test_ key');
}

if (isProduction && (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_ID.startsWith('rzp_live_'))) {
  throw new Error('Production Razorpay configuration requires an rzp_live_ key');
}

if (isProduction && process.env.PAYMENT_MOCK_ENABLED === 'true') {
  throw new Error('PAYMENT_MOCK_ENABLED cannot be enabled in production');
}

const defaultBackendUrl = isProduction ? 'https://api.rupakar.com' : `http://localhost:${process.env.PORT ?? 4000}`;

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 4000),
  MONGODB_URI: (process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/rupakar').trim(),
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  REDIS_ENABLED: isProduction || process.env.REDIS_ENABLED === 'true',
  WORKER_ENABLED: process.env.WORKER_ENABLED !== 'false',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? 'dev-access-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}_refresh` : 'dev-refresh-secret'),
  FRONTEND_URL: process.env.FRONTEND_URL ?? (isProduction ? 'https://rupakar.com' : 'http://localhost:3000'),
  BACKEND_URL: process.env.BACKEND_URL ?? defaultBackendUrl,
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? (isProduction ? 'https://rupakar.com,https://www.rupakar.com,https://seller.rupakar.com,https://admin.rupakar.com' : 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000'),
  SELLER_FRONTEND_URL: process.env.SELLER_FRONTEND_URL ?? (isProduction ? 'https://seller.rupakar.com' : ''),
  COOKIE_DOMAIN: process.env.COOKIE_DOMAIN || (isProduction ? '.rupakar.com' : ''),
  COOKIE_SAMESITE: (process.env.COOKIE_SAMESITE ?? '').toLowerCase(),
  ACCESS_TOKEN_EXPIRATION: process.env.ACCESS_TOKEN_EXPIRATION ?? '15m',
  REFRESH_TOKEN_EXPIRATION: process.env.REFRESH_TOKEN_EXPIRATION ?? '7d',
  REFRESH_TOKEN_MAX_AGE_MS: durationToMs(process.env.REFRESH_TOKEN_EXPIRATION ?? '7d', 7 * 24 * 60 * 60 * 1000),
  EMAIL_PROVIDER: (process.env.EMAIL_PROVIDER ?? 'smtp').toLowerCase().trim(),
  EMAIL_HOST: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
  EMAIL_PORT: Number(process.env.EMAIL_PORT ?? 587),
  EMAIL_USER: process.env.EMAIL_USER ?? 'noreply@example.com',
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD ?? process.env.EMAIL_PASS ?? 'change-me',
  EMAIL_FROM: process.env.EMAIL_FROM ?? process.env.CONTACT_EMAIL ?? (process.env.EMAIL_USER && process.env.EMAIL_USER.includes('@') ? process.env.EMAIL_USER : 'noreply@rupakar.com'),
  CONTACT_EMAIL: process.env.CONTACT_EMAIL ?? process.env.EMAIL_USER ?? 'noreply@example.com',
  RESEND_API_KEY: process.env.RESEND_API_KEY ?? '',
  BREVO_API_KEY: process.env.BREVO_API_KEY ?? '',
  SMS_PROVIDER: process.env.SMS_PROVIDER ?? 'twilio',
  SMS_API_URL: process.env.SMS_API_URL ?? '',
  SMS_API_KEY: process.env.SMS_API_KEY ?? '',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ?? process.env.SMS_ACCOUNT_SID ?? '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN ?? process.env.SMS_AUTH_TOKEN ?? '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER ?? process.env.TWILIO_FROM_NUMBER ?? process.env.SMS_FROM ?? '',
  GOOGLE_CLIENT_ID: (process.env.GOOGLE_CLIENT_ID ?? '').trim(),
  GOOGLE_CLIENT_SECRET: (process.env.GOOGLE_CLIENT_SECRET ?? '').trim(),
  GOOGLE_REDIRECT_URI: (process.env.GOOGLE_REDIRECT_URI && !process.env.GOOGLE_REDIRECT_URI.includes('onrender.com'))
    ? process.env.GOOGLE_REDIRECT_URI
    : `${defaultBackendUrl}/api/v1/auth/google/callback`,
  RUPAKAR_LOGO_URL: process.env.RUPAKAR_LOGO_URL ?? `${defaultBackendUrl}/Rupakar-logo.jpeg`,
  STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? 'rupakar-dev',
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? 'cloudinary', S3_BUCKET_NAME: process.env.S3_BUCKET_NAME ?? '', S3_REGION: process.env.S3_REGION ?? 'us-east-1', S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? '', S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? '', S3_ENDPOINT: process.env.S3_ENDPOINT ?? '',
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? '',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID ?? '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET ?? '',
  RAZORPAY_WEBHOOK_SECRET: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  SHIPPING_ENABLED: String(process.env.SHIPPING_ENABLED ?? (isProduction ? 'false' : 'true')).toLowerCase() !== 'false',
  SHIPPING_BASE_FEE: Number(process.env.SHIPPING_BASE_FEE ?? 50),
  SHIPPING_EXTRA_ITEM_FEE: Number(process.env.SHIPPING_EXTRA_ITEM_FEE ?? 20),
  FREE_SHIPPING_THRESHOLD: Number(process.env.FREE_SHIPPING_THRESHOLD ?? 1500),
  WEST_BENGAL_SHIPPING_DISCOUNT: Number(process.env.WEST_BENGAL_SHIPPING_DISCOUNT ?? 10),
  DELIVERY_MODE: (process.env.DELIVERY_MODE === 'delhivery' && hasRealDeliveryConfig(process.env.DELIVERY_API_URL, process.env.DELIVERY_API_TOKEN)) ? 'delhivery' : 'mock',
  DELIVERY_PROVIDER: (process.env.DELIVERY_PROVIDER === 'delhivery' && hasRealDeliveryConfig(process.env.DELIVERY_API_URL, process.env.DELIVERY_API_TOKEN)) ? 'delhivery' : 'mock',
  DELIVERY_API_URL: process.env.DELIVERY_API_URL ?? '',
  DELIVERY_API_TOKEN: process.env.DELIVERY_API_TOKEN ?? '',
  DELIVERY_WEBHOOK_SECRET: process.env.DELIVERY_WEBHOOK_SECRET ?? 'mock-delivery-webhook-secret',
  PAYMENT_MOCK_ENABLED: isDevelopment && process.env.PAYMENT_MOCK_ENABLED === 'true',
};
