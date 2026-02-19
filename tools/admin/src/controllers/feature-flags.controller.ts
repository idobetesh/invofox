/**
 * Feature Flags Controller
 * REST API handlers for managing feature flags.
 *
 * Routes:
 *   GET    /api/feature-flags              - List all flags
 *   POST   /api/feature-flags              - Create a flag
 *   GET    /api/feature-flags/:key         - Get a single flag
 *   PUT    /api/feature-flags/:key         - Update a flag
 *   PATCH  /api/feature-flags/:key/toggle  - Toggle enabled on/off
 *   PATCH  /api/feature-flags/:key/archive - Soft delete
 *   DELETE /api/feature-flags/:key         - Hard delete
 *   GET    /api/feature-flags/:key/audit   - Get audit log
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { FeatureFlagsService } from '../services/feature-flags.service';

const FLAG_KEY_REGEX = /^[a-z0-9-]+$/;
const FLAG_KEY_MAX_LENGTH = 60;
const FLAG_DESCRIPTION_MAX_LENGTH = 200;

export class FeatureFlagsController {
  constructor(private featureFlagsService: FeatureFlagsService) {}

  listFlags = async (req: Request, res: Response): Promise<void> => {
    try {
      const includeArchived = req.query.includeArchived === 'true';
      const flags = await this.featureFlagsService.listFlags(includeArchived);
      res.json({ flags, total: flags.length });
    } catch (error) {
      console.error('Error listing flags:', error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: `Failed to list flags: ${toMessage(error)}` });
    }
  };

  getFlag = async (req: Request, res: Response): Promise<void> => {
    try {
      const { key } = req.params;
      const flag = await this.featureFlagsService.getFlag(key);

      if (!flag) {
        res.status(StatusCodes.NOT_FOUND).json({ error: `Flag '${key}' not found` });
        return;
      }

      res.json({ flag });
    } catch (error) {
      console.error('Error getting flag:', error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: `Failed to get flag: ${toMessage(error)}` });
    }
  };

  createFlag = async (req: Request, res: Response): Promise<void> => {
    try {
      const { key, description, type, enabled, defaultValue, targets, prerequisites, variants } =
        req.body;

      if (!key || !description || !type) {
        res
          .status(StatusCodes.BAD_REQUEST)
          .json({ error: 'key, description, and type are required' });
        return;
      }

      if (!FLAG_KEY_REGEX.test(key)) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error:
            'key must only contain lowercase letters, numbers, and hyphens (e.g. new-receipt-flow)',
        });
        return;
      }

      if (key.length > FLAG_KEY_MAX_LENGTH) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: `key must be ${FLAG_KEY_MAX_LENGTH} characters or fewer`,
        });
        return;
      }

      if (description.length > FLAG_DESCRIPTION_MAX_LENGTH) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: `description must be ${FLAG_DESCRIPTION_MAX_LENGTH} characters or fewer`,
        });
        return;
      }

      if (!['boolean', 'multivariate', 'string', 'number'].includes(type)) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: 'type must be one of: boolean, multivariate, string, number',
        });
        return;
      }
      if (targets?.percentage !== undefined) {
        const pct = targets.percentage;
        if (typeof pct !== 'number' || pct < 0 || pct > 100) {
          res.status(StatusCodes.BAD_REQUEST).json({
            error: 'targets.percentage must be a number between 0 and 100',
          });
          return;
        }
      }

      if (variants !== undefined) {
        const variantValues = Object.values(variants as Record<string, { weight: number }>);
        const allValidWeights = variantValues.every(
          (v) => typeof v.weight === 'number' && v.weight >= 0
        );
        const weightSum = variantValues.reduce((acc, v) => acc + (v.weight ?? 0), 0);
        if (!allValidWeights || Math.abs(weightSum - 100) > 0.01) {
          res.status(StatusCodes.BAD_REQUEST).json({
            error: 'variant weights must be non-negative numbers summing to 100',
          });
          return;
        }
      }

      const flag = await this.featureFlagsService.createFlag({
        key,
        description,
        type,
        enabled: enabled ?? false,
        defaultValue: defaultValue ?? false,
        targets,
        prerequisites,
        variants,
      });

      res.status(StatusCodes.CREATED).json({ flag });
    } catch (error) {
      const message = toMessage(error);
      const status = message.includes('already exists')
        ? StatusCodes.CONFLICT
        : StatusCodes.INTERNAL_SERVER_ERROR;
      console.error('Error creating flag:', error);
      res.status(status).json({ error: `Failed to create flag: ${message}` });
    }
  };

  updateFlag = async (req: Request, res: Response): Promise<void> => {
    try {
      const { key } = req.params;
      const { description, enabled, defaultValue, targets, prerequisites, variants } = req.body;

      if (description !== undefined && description.length > FLAG_DESCRIPTION_MAX_LENGTH) {
        res.status(StatusCodes.BAD_REQUEST).json({
          error: `description must be ${FLAG_DESCRIPTION_MAX_LENGTH} characters or fewer`,
        });
        return;
      }
      if (targets?.percentage !== undefined) {
        const pct = targets.percentage;
        if (typeof pct !== 'number' || pct < 0 || pct > 100) {
          res.status(StatusCodes.BAD_REQUEST).json({
            error: 'targets.percentage must be a number between 0 and 100',
          });
          return;
        }
      }

      if (variants !== undefined) {
        const variantValues = Object.values(variants as Record<string, { weight: number }>);
        const allValidWeights = variantValues.every(
          (v) => typeof v.weight === 'number' && v.weight >= 0
        );
        const weightSum = variantValues.reduce((acc, v) => acc + (v.weight ?? 0), 0);
        if (!allValidWeights || Math.abs(weightSum - 100) > 0.01) {
          res.status(StatusCodes.BAD_REQUEST).json({
            error: 'variant weights must be non-negative numbers summing to 100',
          });
          return;
        }
      }

      const flag = await this.featureFlagsService.updateFlag(key, {
        description,
        enabled,
        defaultValue,
        targets,
        prerequisites,
        variants,
      });

      res.json({ flag });
    } catch (error) {
      const message = toMessage(error);
      const status = message.includes('not found')
        ? StatusCodes.NOT_FOUND
        : StatusCodes.INTERNAL_SERVER_ERROR;
      console.error('Error updating flag:', error);
      res.status(status).json({ error: `Failed to update flag: ${message}` });
    }
  };

  toggleFlag = async (req: Request, res: Response): Promise<void> => {
    try {
      const { key } = req.params;
      const result = await this.featureFlagsService.toggleFlag(key);
      res.json(result);
    } catch (error) {
      const message = toMessage(error);
      const status = message.includes('not found')
        ? StatusCodes.NOT_FOUND
        : StatusCodes.INTERNAL_SERVER_ERROR;
      console.error('Error toggling flag:', error);
      res.status(status).json({ error: `Failed to toggle flag: ${message}` });
    }
  };

  archiveFlag = async (req: Request, res: Response): Promise<void> => {
    try {
      const { key } = req.params;
      await this.featureFlagsService.archiveFlag(key);
      res.json({ success: true, message: `Flag '${key}' archived` });
    } catch (error) {
      const message = toMessage(error);
      const status = message.includes('not found')
        ? StatusCodes.NOT_FOUND
        : StatusCodes.INTERNAL_SERVER_ERROR;
      console.error('Error archiving flag:', error);
      res.status(status).json({ error: `Failed to archive flag: ${message}` });
    }
  };

  deleteFlag = async (req: Request, res: Response): Promise<void> => {
    try {
      const { key } = req.params;
      await this.featureFlagsService.deleteFlag(key);
      res.json({ success: true, message: `Flag '${key}' permanently deleted` });
    } catch (error) {
      const message = toMessage(error);
      const status = message.includes('not found')
        ? StatusCodes.NOT_FOUND
        : StatusCodes.INTERNAL_SERVER_ERROR;
      console.error('Error deleting flag:', error);
      res.status(status).json({ error: `Failed to delete flag: ${message}` });
    }
  };

  getAuditLog = async (req: Request, res: Response): Promise<void> => {
    try {
      const { key } = req.params;
      const entries = await this.featureFlagsService.getAuditLog(key);
      res.json({ entries, total: entries.length });
    } catch (error) {
      console.error('Error getting audit log:', error);
      res
        .status(StatusCodes.INTERNAL_SERVER_ERROR)
        .json({ error: `Failed to get audit log: ${toMessage(error)}` });
    }
  };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}
