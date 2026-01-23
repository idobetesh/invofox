import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { HealthService } from '../services/health.service';

export class HealthController {
  constructor(private healthService: HealthService) {}

  /**
   * Health check endpoint
   */
  check = async (req: Request, res: Response): Promise<void> => {
    try {
      const healthStatus = await this.healthService.getHealthStatus();
      res.json(healthStatus);
    } catch (error) {
      console.error('Error checking health:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        overall: 'unhealthy',
        services: [],
        version: { sha: 'unknown', shortSha: 'unknown' },
        timestamp: new Date().toISOString(),
        error: 'Failed to check health status',
      });
    }
  };
}
