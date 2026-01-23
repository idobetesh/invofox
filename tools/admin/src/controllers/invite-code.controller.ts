import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { InviteCodeService } from '../services/invite-code.service';

export class InviteCodeController {
  constructor(private inviteCodeService: InviteCodeService) {}

  /**
   * Create a new invite code
   * POST /api/invite-codes
   * Body: { adminUserId, adminUsername, note?, expiresInDays? }
   */
  createInviteCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { adminUserId, adminUsername, note, expiresInDays } = req.body;

      if (!adminUserId || !adminUsername) {
        res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: 'adminUserId and adminUsername are required' });
        return;
      }

      const inviteCode = await this.inviteCodeService.createInviteCode({
        adminUserId: parseInt(adminUserId, 10),
        adminUsername,
        note,
        expiresInDays: expiresInDays ? parseInt(expiresInDays, 10) : undefined,
      });

      res.status(StatusCodes.CREATED).json({ inviteCode });
    } catch (error) {
      console.error('Error creating invite code:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to create invite code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * List all invite codes
   * GET /api/invite-codes?status=active|used|expired|all
   */
  listInviteCodes = async (req: Request, res: Response): Promise<void> => {
    try {
      const status = (req.query.status as string) || 'all';

      if (!['active', 'used', 'expired', 'all'].includes(status)) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'Invalid status filter' });
        return;
      }

      const inviteCodes = await this.inviteCodeService.listInviteCodes(
        status as 'active' | 'used' | 'expired' | 'all'
      );

      res.json({ inviteCodes });
    } catch (error) {
      console.error('Error listing invite codes:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to list invite codes: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Get a specific invite code
   * GET /api/invite-codes/:code
   */
  getInviteCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;

      const inviteCode = await this.inviteCodeService.getInviteCode(code);

      if (!inviteCode) {
        res.status(StatusCodes.NOT_FOUND).json({ error: 'Invite code not found' });
        return;
      }

      res.json({ inviteCode });
    } catch (error) {
      console.error('Error getting invite code:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to get invite code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Revoke an invite code
   * POST /api/invite-codes/:code/revoke
   */
  revokeInviteCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;

      await this.inviteCodeService.revokeInviteCode(code);

      res.json({ success: true, message: `Invite code ${code} has been revoked` });
    } catch (error) {
      console.error('Error revoking invite code:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to revoke invite code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Delete an invite code
   * DELETE /api/invite-codes/:code
   */
  deleteInviteCode = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;

      await this.inviteCodeService.deleteInviteCode(code);

      res.json({ success: true, message: `Invite code ${code} has been deleted` });
    } catch (error) {
      console.error('Error deleting invite code:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to delete invite code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Get onboarding session status for an invite code
   * GET /api/invite-codes/:code/onboarding-status
   */
  getOnboardingStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;

      const status = await this.inviteCodeService.getOnboardingStatus(code);

      res.json({ status });
    } catch (error) {
      console.error('Error getting onboarding status:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to get onboarding status: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Clean onboarding session only (keep invite code)
   * POST /api/invite-codes/:code/cleanup-session
   */
  cleanupSession = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;

      await this.inviteCodeService.cleanupOnboardingSession(code);

      res.json({ success: true, message: `Onboarding session cleaned for ${code}` });
    } catch (error) {
      console.error('Error cleaning session:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to clean session: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  /**
   * Delete both invite code and onboarding session
   * POST /api/invite-codes/:code/delete-all
   */
  deleteAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const { code } = req.params;

      await this.inviteCodeService.deleteCodeAndSession(code);

      res.json({ success: true, message: `Invite code and session deleted for ${code}` });
    } catch (error) {
      console.error('Error deleting all:', error);
      res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
        error: `Failed to delete all: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };
}
