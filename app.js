import express, { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './app/docs/swagger.js';
import { env } from './app/config/env.js';
import { securityMiddleware } from './app/middleware/security.js';
import { requestIdMiddleware } from './app/middleware/request-id.js';
import { errorHandler, notFoundHandler } from './app/middleware/error-handler.js';
import { requireAuth } from './app/middleware/auth.middleware.js';
import { getVendorDashboard, getVendorAnalytics } from './app/controllers/vendor.controller.js';
import authRoutes from './app/routers/auth.routes.js';
import userRoutes from './app/routers/user.routes.js';
import vendorRoutes from './app/routers/vendor.routes.js';
import categoryRoutes from './app/routers/category.routes.js';
import brandRoutes from './app/routers/brand.routes.js';
import productRoutes from './app/routers/product.routes.js';
import inventoryRoutes from './app/routers/inventory.routes.js';
import cartRoutes from './app/routers/cart.routes.js';
import wishlistRoutes from './app/routers/wishlist.routes.js';
import checkoutRoutes from './app/routers/checkout.routes.js';
import orderRoutes from './app/routers/order.routes.js';
import shipmentRoutes from './app/routers/shipment.routes.js';
import returnRoutes from './app/routers/return.routes.js';
import paymentRoutes from './app/routers/payment.routes.js';
import invoiceRoutes from './app/routers/invoice.routes.js';
import notificationRoutes from './app/routers/notification.routes.js';
import reviewRoutes from './app/routers/review.routes.js';
import adminRoutes from './app/routers/admin.routes.js';
import financeRoutes from './app/routers/finance.routes.js';
import supportRoutes from './app/routers/support.routes.js';
import contactRoutes from './app/routers/contact.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  let redis = null;

  if (env.REDIS_ENABLED) {
    const isTls = env.REDIS_URL?.startsWith('rediss://');
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 100, 3000),
      ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
    });

    redis.on('error', () => {
      // Redis is optional for local development. API requests continue without cache.
    });
  }

  app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use('/api/v1/webhooks/delivery', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use('/Rupakar-logo.jpeg', express.static(path.join(__dirname, 'public', 'Rupakar-logo.jpeg')));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.use(morgan('combined'));
  app.use(...securityMiddleware);

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', userRoutes);
  const vendorDashboardRouter = Router();
  vendorDashboardRouter.get('/dashboard', requireAuth, getVendorDashboard);
  vendorDashboardRouter.get('/analytics', requireAuth, getVendorAnalytics);
  app.use('/api/v1/vendor', vendorDashboardRouter);
  app.use('/api/v1/vendors', vendorRoutes);
  app.use('/api/v1/categories', categoryRoutes);
  app.use('/api/v1/brands', brandRoutes);
  app.use('/api/v1', productRoutes);
  app.use('/api/v1', inventoryRoutes);
  app.use('/api/v1', cartRoutes);
  app.use('/api/v1/wishlist', wishlistRoutes);
  app.use('/api/v1/checkout', checkoutRoutes);
  app.use('/api/v1/orders', orderRoutes);
  app.use('/api/v1', shipmentRoutes);
  app.use('/api/v1', returnRoutes);
  app.use('/api/v1/payments', paymentRoutes);
  app.use('/api/v1/invoices', invoiceRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/reviews', reviewRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1', financeRoutes);
  app.use('/api/v1/support', supportRoutes);
  app.use('/api/v1/contact', contactRoutes);

  app.get('/api/v1/health', (_req, res) => {
    res.status(200).json({
      success: true,
      data: { api: 'ok', timestamp: new Date().toISOString() },
      message: 'Service healthy',
      requestId: String(_req.headers['x-request-id'] ?? ''),
    });
  });

  app.get('/api/v1/health/live', (_req, res) => {
    res.status(200).json({
      success: true,
      data: { status: 'live' },
      message: 'Application is live',
      requestId: String(_req.headers['x-request-id'] ?? ''),
    });
  });

  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      const mongoState = mongoose.connection.readyState === 1 ? 'ready' : 'not-ready';
      const activeRedis = app.locals.redis ?? redis;
      const redisState = activeRedis && activeRedis.status === 'ready' ? 'ready' : (env.REDIS_ENABLED ? 'not-ready' : 'disabled');
      const workerHeartbeat = env.WORKER_ENABLED && redisState === 'ready' ? await activeRedis.get('rupakar:worker:heartbeat') : null;
      const workerState = !env.WORKER_ENABLED ? 'disabled' : env.REDIS_ENABLED ? (workerHeartbeat ? 'ready' : 'not-ready') : 'disabled';
      const ready = mongoState === 'ready' && redisState !== 'not-ready' && workerState !== 'not-ready';

      res.status(ready ? 200 : 503).json({
        success: ready,
        data: { mongo: mongoState, redis: redisState, worker: workerState },
        message: ready ? 'Service ready' : 'Service not ready',
        requestId: String(_req.headers['x-request-id'] ?? ''),
      });
    } catch {
      res.status(503).json({
        success: false,
        error: { code: 'READINESS_CHECK_FAILED', message: 'Health checks failed' },
        requestId: String(_req.headers['x-request-id'] ?? ''),
      });
    }
  });

  app.get('/', (_req, res) => {
    res.redirect('/api/v1/health');
  });

  const isSwaggerEnabled = process.env.NODE_ENV !== 'production' || process.env.ENABLE_SWAGGER === 'true';
  if (isSwaggerEnabled) {
    const swaggerUiOptions = {
      customSiteTitle: 'Rupakar Marketplace API Documentation',
    };

    app.get(['/api/docs.json', '/api-docs.json'], (_req, res) => {
      res.status(200).json(swaggerSpec);
    });

    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  app.locals.redis = redis;
  return app;
}

const app = createApp();
export default app;
