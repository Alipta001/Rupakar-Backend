import { spawn } from 'node:child_process';
import mongoose from 'mongoose';
import app from './app.js';
import { env } from './app/config/env.js';
import { connectMongo } from './app/database/connection.js';

const PORT = Number(env.PORT ?? 4000);
let workerProcess = null;
let workerShutdownRequested = false;

function startWorkerProcess() {
  if (process.env.RUPAKAR_WORKER_CHILD === 'true') {
    return null;
  }

  if (!env.WORKER_ENABLED) {
    console.log('BullMQ workers disabled by WORKER_ENABLED=false');
    return null;
  }

  if (workerProcess) {
    return workerProcess;
  }

  console.log('Starting BullMQ worker in the same Render service...');
  workerProcess = spawn(process.execPath, ['worker.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_ENABLED: 'true',
      RUPAKAR_WORKER_CHILD: 'true',
    },
    stdio: 'inherit',
  });

  workerProcess.on('exit', (code, signal) => {
    if (workerShutdownRequested) {
      return;
    }
    console.warn(`BullMQ worker exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`);
  });

  workerProcess.on('error', (error) => {
    console.error('BullMQ worker failed to start:', error);
  });

  return workerProcess;
}

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

  startWorkerProcess();

  const server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });

  const shutdown = async () => {
    workerShutdownRequested = true;

    if (workerProcess && !workerProcess.killed) {
      workerProcess.kill('SIGTERM');
      await new Promise((resolve) => {
        workerProcess.once('exit', resolve);
      }).catch(() => {});
    }

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
