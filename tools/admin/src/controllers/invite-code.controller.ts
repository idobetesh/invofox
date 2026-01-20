import { Request, Response } from 'express';
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
        res.status(400).json({ error: 'adminUserId and adminUsername are required' });
        return;
      }

      const inviteCode = await this.inviteCodeService.createInviteCode({
        adminUserId: parseInt(adminUserId, 10),
        adminUsername,
        note,
        expiresInDays: expiresInDays ? parseInt(expiresInDays, 10) : undefined,
      });

      res.status(201).json({ inviteCode });
    } catch (error) {
      console.error('Error creating invite code:', error);
      res.status(500).json({
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
        res.status(400).json({ error: 'Invalid status filter' });
        return;
      }

      const inviteCodes = await this.inviteCodeService.listInviteCodes(
        status as 'active' | 'used' | 'expired' | 'all'
      );

      res.json({ inviteCodes });
    } catch (error) {
      console.error('Error listing invite codes:', error);
      res.status(500).json({
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
        res.status(404).json({ error: 'Invite code not found' });
        return;
      }

      res.json({ inviteCode });
    } catch (error) {
      console.error('Error getting invite code:', error);
      res.status(500).json({
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
      res.status(500).json({
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
      res.status(500).json({
        error: `Failed to delete invite code: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };
}
