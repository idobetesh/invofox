/**
 * Webhook Handler Service - Entry Point
 */

import app from './app';
import { loadConfig } from './config';
import logger from './logger';

async function main(): Promise<void> {
  try {
    const config = loadConfig();

    logger.info(
      {
        port: config.port,
        project: config.projectId,
        queue: config.queueName,
        workerUrl: config.workerUrl,
      },
      'Configuration loaded'
    );

    app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Webhook handler started');
    });
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
