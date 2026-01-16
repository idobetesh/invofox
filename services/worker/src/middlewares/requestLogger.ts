/**
 * HTTP request logging middleware using morgan
 */

import morgan from 'morgan';
import logger from '../logger';

export const requestLogger = morgan(
  ':method :url :status :res[content-length] - :response-time ms',
  {
    stream: {
      write: (message: string) => {
        // Extract status code from message (format: "METHOD URL STATUS ...")
        const statusMatch = message.match(/\s(\d{3})\s/);
        const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 200;

        // Log as error for 4xx and 5xx status codes
        if (statusCode >= 400) {
          logger.error(message.trim());
        } else {
          logger.info(message.trim());
        }
      },
    },
  }
);
