/**
 * Broadcast Controller
 * REST API handlers for sending push notifications to customers via Telegram.
 *
 * Routes:
 *   GET  /api/broadcasts   - List sent broadcast history (newest first)
 *   POST /api/broadcasts   - Send a new broadcast immediately
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { BroadcastService, CreateBroadcastDto } from '../services/broadcast.service';
import { CustomerService } from '../services/customer.service';

const MESSAGE_MAX_LENGTH = 4096;
const CAPTION_MAX_LENGTH = 1024;

export class BroadcastController {
  constructor(
    private broadcastService: BroadcastService,
    private customerService: CustomerService
  ) {}

  listBroadcasts = async (_req: Request, res: Response): Promise<void> => {
    try {
      const broadcasts = await this.broadcastService.listBroadcasts();
      res.json({ broadcasts, total: broadcasts.length });
    } catch (error) {
      console.error('Error listing broadcasts:', error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: `Failed to list broadcasts: ${toMessage(error)}` });
    }
  };

  sendBroadcast = async (req: Request, res: Response): Promise<void> => {
    try {
      const { message, imageUrl, targets } = req.body;

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'message is required' });
        return;
      }

      if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '') {
        if (typeof imageUrl !== 'string' || !/^https?:\/\/.+/i.test(imageUrl.trim())) {
          res.status(StatusCodes.BAD_REQUEST).json({
            error:
              'imageUrl must be a public https:// URL — data: URIs and local paths are not supported by Telegram',
          });
          return;
        }
      }

      const limit = imageUrl ? CAPTION_MAX_LENGTH : MESSAGE_MAX_LENGTH;
      if (message.length > limit) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: `message exceeds ${limit} character limit (${imageUrl ? 'photo caption' : 'text message'})`,
        });
        return;
      }

      if (targets === undefined || targets === null) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'targets is required' });
        return;
      }

      if (targets !== 'all' && !Array.isArray(targets)) {
        res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: 'targets must be "all" or an array of chatIds' });
        return;
      }

      if (Array.isArray(targets) && targets.length === 0) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'targets array must not be empty' });
        return;
      }

      const customers = await this.customerService.listCustomers();
      const allChatIds = customers.map((c) => c.chatId);

      if (allChatIds.length === 0) {
        res.status(StatusCodes.BAD_REQUEST).json({ error: 'No customers found to send to' });
        return;
      }

      const dto: CreateBroadcastDto = {
        message: message.trim(),
        targets,
        ...(imageUrl && typeof imageUrl === 'string' && imageUrl.trim()
          ? { imageUrl: imageUrl.trim() }
          : {}),
      };

      const broadcast = await this.broadcastService.sendBroadcast(dto, allChatIds);

      res.status(StatusCodes.CREATED).json({ broadcast });
    } catch (error) {
      console.error('Error sending broadcast:', error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: `Failed to send broadcast: ${toMessage(error)}` });
    }
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
