import mongoose from 'mongoose';
import app from './app.js';
import { env } from './app/config/env.js';
import { connectMongo } from './app/database/connection.js';

const PORT = Number(env.PORT ?? 4000);

async function startServer() {
  await connectMongo();

  const redis = app.locals.redis;
  if (env.REDIS_ENABLED) {
    try {
      await redis.connect();
      console.log('Redis connected');
    } catch (_error) {
      if (env.NODE_ENV === 'production') {
        throw new Error('Redis is required in production');
      }
      console.warn('Redis unavailable; continuing without background queue processing');
    }
  }

  const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    await new Promise((resolve) => server.close(resolve));
    if (redis && (redis.status === 'ready' || redis.status === 'connecting')) {
      redis.disconnect();
    }
    if (mongoose?.connection?.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
