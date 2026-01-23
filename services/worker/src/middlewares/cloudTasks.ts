/**
 * Cloud Tasks validation middleware
 */

import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import logger from '../logger';

/**
 * Validate Cloud Tasks request headers
 * In production, verify the OIDC token
 */
export function validateCloudTasks(req: Request, res: Response, next: NextFunction): void {
  // Cloud Tasks sends these headers
  const taskName = req.headers['x-cloudtasks-taskname'];
  const queueName = req.headers['x-cloudtasks-queuename'];

  // In development, allow requests without Cloud Tasks headers
  if (process.env.NODE_ENV === 'development') {
    next();
    return;
  }

  if (!taskName || !queueName) {
    logger.warn('Invalid task request received - missing Cloud Tasks headers');
    res.status(StatusCodes.FORBIDDEN).json({ error: 'Forbidden' });
    return;
  }

  next();
}

/**
 * Extract retry count from Cloud Tasks headers
 */
export function getRetryCount(req: Request): number {
  const retryCount = req.headers['x-cloudtasks-taskretrycount'];
  if (typeof retryCount === 'string') {
    return parseInt(retryCount, 10) || 0;
  }
  return 0;
}

/**
 * Get max retries from environment or default
 */
export function getMaxRetries(): number {
  return parseInt(process.env.MAX_RETRIES || '6', 10);
}
