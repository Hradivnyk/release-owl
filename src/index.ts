import 'dotenv/config';
import cron from 'node-cron';
import app from './app.js';
import { config } from './platform/config/index.js';
import { broker, scannerService, outboxRelay } from './container.js';
import logger from './platform/logger.js';

const PORT = config.server.port;
const SHUTDOWN_TIMEOUT_MS = 10_000;

if (!cron.validate(config.scanner.cronSchedule)) {
  throw new Error(
    `Invalid cron schedule: "${config.scanner.cronSchedule}". Check SCANNER_CRON_SCHEDULE in your .env file.`,
  );
}

async function startApp(): Promise<void> {
  await broker.connect();

  const server = await new Promise<ReturnType<typeof app.listen>>(
    (resolve, reject) => {
      const s = app.listen(PORT, () => {
        logger.info({ event: 'server.started', port: PORT }, 'Server started');
        resolve(s);
      });
      s.once('error', reject);
    },
  );

  outboxRelay.start();
  scannerService.start();

  function gracefulShutdown(code = 0): void {
    logger.info(
      { event: 'server.shutdown.started' },
      'Graceful shutdown started',
    );

    const timer = setTimeout(() => {
      logger.error(
        { event: 'server.shutdown.timeout' },
        'Shutdown timed out, forcing exit',
      );
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    outboxRelay.stop();

    server.close(() => {
      broker
        .close()
        .then(() => {
          clearTimeout(timer);
          process.exit(code);
        })
        .catch((err: unknown) => {
          clearTimeout(timer);
          logger.error({ err }, 'Error closing broker during shutdown');
          process.exit(1);
        });
    });
  }

  process.on('SIGTERM', () => {
    logger.info(
      { event: 'server.shutdown' },
      'SIGTERM received, shutting down',
    );
    gracefulShutdown(0);
  });
  process.on('SIGINT', () => {
    logger.info({ event: 'server.shutdown' }, 'SIGINT received, shutting down');
    gracefulShutdown(0);
  });
}

startApp().catch((err: unknown) => {
  logger.error({ err }, 'Failed to start application');
  process.exit(1);
});
