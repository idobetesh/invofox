/**
 * Global error handling middleware
 */

import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import logger from '../logger';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  logger.error({ err }, 'Unhandled error');
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
}
