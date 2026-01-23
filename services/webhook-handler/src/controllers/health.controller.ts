/**
 * Health check controller
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';

const VERSION = process.env.APP_VERSION || 'development';

export function getHealth(_req: Request, res: Response): void {
  res.status(StatusCodes.OK).json({
    status: 'healthy',
    version: VERSION,
  });
}
