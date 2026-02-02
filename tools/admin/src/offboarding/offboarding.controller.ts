/**
 * Offboarding Controller - API endpoints for data deletion
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { OffboardingService } from './offboarding.service';

export class OffboardingController {
  constructor(private offboardingService: OffboardingService) {}

  /**
   * GET /api/offboard/business/:chatId/preview
   * Preview what will be deleted for a business
   */
  previewBusinessOffboarding = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatId = parseInt(req.params.chatId, 10);

      if (isNaN(chatId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid chatId' });
        return;
      }

      const preview = await this.offboardingService.previewBusinessOffboarding(chatId);
      res.json(preview);
    } catch (error) {
      console.error('Error previewing business offboarding:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/offboard/business/:chatId
   * Execute business offboarding
   */
  offboardBusiness = async (req: Request, res: Response): Promise<void> => {
    try {
      const chatId = parseInt(req.params.chatId, 10);

      if (isNaN(chatId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid chatId' });
        return;
      }

      const report = await this.offboardingService.offboardBusiness(chatId);

      res.json({
        success: true,
        chatId,
        report,
        message: `Business ${chatId} has been completely removed from the system`,
      });
    } catch (error) {
      console.error('Error offboarding business:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
    }
  };

  /**
   * GET /api/offboard/user/:userId/preview
   * Preview what will be deleted for a user (GDPR)
   */
  previewUserOffboarding = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.userId, 10);

      if (isNaN(userId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid userId' });
        return;
      }

      const preview = await this.offboardingService.previewUserOffboarding(userId);
      res.json(preview);
    } catch (error) {
      console.error('Error previewing user offboarding:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
    }
  };

  /**
   * DELETE /api/offboard/user/:userId
   * Execute user offboarding (GDPR Right to Erasure)
   */
  offboardUser = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = parseInt(req.params.userId, 10);

      if (isNaN(userId)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid userId' });
        return;
      }

      const report = await this.offboardingService.offboardUser(userId);

      res.json({
        success: true,
        userId,
        report,
        message: `User ${userId} personal data has been completely removed (GDPR compliance)`,
      });
    } catch (error) {
      console.error('Error offboarding user:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({ error: 'Internal server error' });
    }
  };
}
