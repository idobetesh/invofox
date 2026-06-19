import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AlertsService } from '../services/alerts.service';

export class AlertsController {
  constructor(private alertsService: AlertsService) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.alertsService.getAlerts();
      res.json(data);
    } catch (error) {
      console.error('Error loading alerts:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: error instanceof Error ? error.message : 'Failed to load alerts',
      });
    }
  };
}
