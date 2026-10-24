/**
 * Global error handling middleware
 */

import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import logger from '../logger';

interface ErrorWithStatus extends Error {
  status?: number;
  statusCode?: number;
}

export function errorHandler(
  err: ErrorWithStatus,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Use error status if available (e.g., from body-parser), otherwise 500
  const status = err.status || err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR;
  const isClientError = status >= 400 && status < 500;

  // Log server errors, warn on client errors
  if (isClientError) {
    // Parser errors can contain the raw body; do not copy user-supplied secrets into logs.
    logger.warn({ errorType: err.name, status }, 'Client error');
  } else {
    logger.error({ err, status }, 'Server error');
  }

  res.status(status).json({
    error: isClientError ? err.message || 'Bad request' : 'Internal server error',
  });
}
