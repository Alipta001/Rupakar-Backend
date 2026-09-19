import { ensureQueueConnection, getQueueConnection, startInvoiceWorker, startNotificationWorker, startEmailWorker } from './app/jobs/queues.js';
import { connectMongo, disconnectMongo } from './app/database/connection.js';

async function startWorkers() {
  console.log('Starting BullMQ workers...');

  if (!process.env.WORKER_ENABLED || process.env.WORKER_ENABLED === 'false') {
    console.log('BullMQ workers disabled by WORKER_ENABLED=false');
    return;
  }

  try {
    await connectMongo();
    await ensureQueueConnection();
    const heartbeat = getQueueConnection();
    await heartbeat.set('rupakar:worker:heartbeat', Date.now().toString(), 'EX', 30);
    const heartbeatTimer = globalThis.setInterval(() => {
      heartbeat.set('rupakar:worker:heartbeat', Date.now().toString(), 'EX', 30).catch(() => {});
    }, 10000);

    const invoiceWorker = await startInvoiceWorker();
    console.log('✓ Invoice worker started');

    const notificationWorker = await startNotificationWorker();
    console.log('✓ Notification worker started');

    const emailWorker = await startEmailWorker();
    console.log('✓ Email worker started');

    console.log('\nWorkers are running. Press Ctrl+C to stop.');

    const shutdown = async () => {
      console.log('\nShutting down workers...');
      globalThis.clearInterval(heartbeatTimer);
      await heartbeat.del('rupakar:worker:heartbeat');
      await invoiceWorker.close();
      await notificationWorker.close();
      await emailWorker.close();
      if (heartbeat.status === 'ready' || heartbeat.status === 'connecting') {
        heartbeat.disconnect();
      }
      await disconnectMongo();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start workers:', error);
    process.exit(1);
  }
}

startWorkers();
