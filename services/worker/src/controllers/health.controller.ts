/**
 * Health check controller
 */

import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { Firestore } from '@google-cloud/firestore';
import type { JobStatus } from '../../../../shared/types';
import logger from '../logger';

const VERSION = process.env.APP_VERSION || 'development';

let firestore: Firestore | null = null;

function getFirestore(): Firestore {
  if (!firestore) {
    firestore = new Firestore();
  }
  return firestore;
}

export function getHealth(_req: Request, res: Response): void {
  res.status(StatusCodes.OK).json({
    status: 'healthy',
    version: VERSION,
  });
}

/**
 * Get job metrics for monitoring dashboard
 * Returns counts by status and recent failures
 */
export async function getMetrics(_req: Request, res: Response): Promise<void> {
  try {
    const db = getFirestore();
    const collection = db.collection('invoice_jobs');

    // Get counts by status
    const statuses: JobStatus[] = [
      'pending',
      'processing',
      'processed',
      'failed',
      'pending_retry',
      'pending_decision',
    ];
    const counts: Record<string, number> = {};

    await Promise.all(
      statuses.map(async (status) => {
        const snapshot = await collection.where('status', '==', status).count().get();
        counts[status] = snapshot.data().count;
      })
    );

    // Get recent failures (last 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const recentFailures = await collection
      .where('status', '==', 'failed')
      .where('updatedAt', '>=', oneDayAgo)
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get();

    const failures = recentFailures.docs.map((doc) => {
      const data = doc.data();
      return {
        jobId: doc.id,
        lastStep: data.lastStep,
        lastError: data.lastError,
        attempts: data.attempts,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Get pending retries (jobs waiting for Cloud Tasks retry)
    const pendingRetries = await collection
      .where('status', '==', 'pending_retry')
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get();

    const retrying = pendingRetries.docs.map((doc) => {
      const data = doc.data();
      return {
        jobId: doc.id,
        lastStep: data.lastStep,
        lastError: data.lastError,
        attempts: data.attempts,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null,
      };
    });

    // Calculate health score (0-100)
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const failedPercent = total > 0 ? (counts.failed / total) * 100 : 0;
    const healthScore = Math.max(0, Math.min(100, Math.round(100 - failedPercent * 5))); // -5 points per 1% failure, capped at 0-100

    res.status(StatusCodes.OK).json({
      status: healthScore >= 80 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'unhealthy',
      healthScore,
      version: VERSION,
      timestamp: new Date().toISOString(),
      counts,
      totals: {
        total,
        successRate: total > 0 ? ((counts.processed / total) * 100).toFixed(1) + '%' : 'N/A',
      },
      recentFailures: failures,
      pendingRetries: retrying,
    });
  } catch (error) {
    logger.error({ error }, 'Failed to get metrics');
    res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
