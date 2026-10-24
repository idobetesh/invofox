/**
 * HTTP request logging middleware using morgan
 */

import morgan from 'morgan';
import logger from '../logger';
import type { Request, Response } from 'express';

// Log route patterns, never credential-bearing paths or user-controlled query strings.
morgan.token<Request, Response>('route-pattern', (req) => req.route?.path || '[unmatched]');

export const requestLogger = morgan(
  ':method :route-pattern :status :res[content-length] - :response-time ms',
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
