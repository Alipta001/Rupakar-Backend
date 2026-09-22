import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = ['development', 'local'].includes(process.env.NODE_ENV ?? 'development');
const productionSecretNames = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const hasPlaceholder = (value) => !value || /change-me|dev-(access|refresh)-secret/i.test(value);

if (isProduction) {
  const missing = [
    'MONGODB_URI',
    'REDIS_URL',
    'FRONTEND_URL',
    'CORS_ALLOWED_ORIGINS',
    'EMAIL_HOST',
    'EMAIL_USER',
    'EMAIL_PASSWORD',
    'STORAGE_BUCKET',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'RAZORPAY_KEY_ID',
    'RAZORPAY_KEY_SECRET',
    'RAZORPAY_WEBHOOK_SECRET',
    ...productionSecretNames,
  ].filter((name) => hasPlaceholder(process.env[name]));

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

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 4000),
  MONGODB_URI: (process.env.MONGODB_URI || process.env.MONGO_URL || 'mongodb://127.0.0.1:27017/rupakar').trim(),
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  REDIS_ENABLED: isProduction || process.env.REDIS_ENABLED === 'true',
  WORKER_ENABLED: process.env.WORKER_ENABLED !== 'false',
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? process.env.JWT_SECRET ?? 'dev-access-secret',
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? (process.env.JWT_SECRET ? `${process.env.JWT_SECRET}_refresh` : 'dev-refresh-secret'),
  FRONTEND_URL: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000',
  EMAIL_HOST: process.env.EMAIL_HOST ?? 'smtp.gmail.com',
  EMAIL_PORT: Number(process.env.EMAIL_PORT ?? 465),
  EMAIL_USER: process.env.EMAIL_USER ?? 'noreply@example.com',
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD ?? process.env.EMAIL_PASS ?? 'change-me',
  CONTACT_EMAIL: process.env.CONTACT_EMAIL ?? process.env.EMAIL_USER ?? 'noreply@example.com',
  SMS_PROVIDER: process.env.SMS_PROVIDER ?? 'twilio',
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
  PAYMENT_MOCK_ENABLED: isDevelopment && process.env.PAYMENT_MOCK_ENABLED === 'true',
};
