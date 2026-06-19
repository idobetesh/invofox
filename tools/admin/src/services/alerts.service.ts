/**
 * System alerts for the admin portal
 * Aggregates worker LLM health + recent issues from Firestore
 */

import { Firestore } from '@google-cloud/firestore';
import { GoogleAuth } from 'google-auth-library';
import { INVOICE_JOBS_COLLECTION } from '../../../../shared/collections';
import { toMillis } from '../utils/timestamp';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface SystemAlert {
  id: string;
  severity: AlertSeverity;
  type: string;
  title: string;
  message: string;
  timestamp: string | null;
  metadata?: Record<string, unknown>;
}

export interface GeminiWorkerHealth {
  status: 'ok' | 'unavailable' | 'unconfigured' | 'unknown';
  model: string | null;
  checkedAt: string | null;
  errorCode: string | null;
  errorMessage?: string | null;
}

export interface LlmFallbackEvent {
  jobId: string;
  vendorName: string | null;
  chatTitle: string;
  llmProvider: string | null;
  fallbackReason: string | null;
  receivedAt: string;
  createdAt: string | null;
}

export interface AlertsSummary {
  alertCount: number;
  criticalCount: number;
  warningCount: number;
  hasIssues: boolean;
}

export interface LlmUsageStats {
  scannedJobs: number;
  processedCount: number;
  geminiCount: number;
  openaiCount: number;
  unknownProviderCount: number;
  openAiStreak: number;
  lastGeminiAt: string | null;
  lastOpenAiAt: string | null;
}

export interface RecentLlmJob {
  jobId: string;
  vendorName: string | null;
  chatTitle: string;
  llmProvider: string | null;
  llmFallbackFrom: string | null;
  llmFallbackReason: string | null;
  status: string;
  createdAt: string | null;
}

export interface WorkerDiagnostics {
  workerUrl: string | null;
  workerReachable: boolean;
  workerVersion: string | null;
  geminiMonitoringSupported: boolean;
  recommendedActions: string[];
}

export interface AlertsResponse {
  summary: AlertsSummary;
  gemini: GeminiWorkerHealth | null;
  workerConfigured: boolean;
  workerReachable: boolean;
  workerVersion: string | null;
  diagnostics: WorkerDiagnostics;
  llmStats: LlmUsageStats;
  alerts: SystemAlert[];
  recentFallbacks: LlmFallbackEvent[];
  recentLlmJobs: RecentLlmJob[];
  timestamp: string;
}

const FALLBACK_LOOKBACK_DAYS = 30;
const FAILED_LOOKBACK_DAYS = 7;
const JOB_SCAN_LIMIT = 150;

function summarizeFallbackReason(reason: string | null | undefined): string {
  if (!reason) {
    return 'Gemini failed; OpenAI was used instead.';
  }
  const lower = reason.toLowerCase();
  if (lower.includes('no longer available') || lower.includes('404')) {
    return 'Gemini model is unavailable — update GEMINI_MODEL and redeploy the worker.';
  }
  if (lower.includes('429') || lower.includes('quota') || lower.includes('rate')) {
    return 'Gemini rate limit or quota exceeded.';
  }
  if (lower.includes('401') || lower.includes('api key') || lower.includes('unauthorized')) {
    return 'Gemini API key is invalid or unauthorized.';
  }
  return reason.length > 180 ? `${reason.slice(0, 180)}…` : reason;
}

function humanizeGeminiStatus(status: GeminiWorkerHealth['status']): string {
  switch (status) {
    case 'ok':
      return 'Healthy';
    case 'unavailable':
      return 'Unavailable';
    case 'unconfigured':
      return 'Not configured';
    case 'unknown':
      return 'Unknown (worker not reporting)';
    default:
      return status;
  }
}

function humanizeErrorCode(code: string | null | undefined): string {
  if (!code) {
    return 'unknown';
  }
  switch (code) {
    case 'model_not_found':
      return 'Model not found (deprecated or wrong GEMINI_MODEL)';
    case 'rate_limit':
      return 'Rate limit / quota';
    case 'auth':
      return 'API key / auth failure';
    case 'json_parse':
      return 'Invalid JSON from Gemini';
    case 'empty_response':
      return 'Empty Gemini response';
    case 'health_endpoint_legacy':
      return 'Old worker build (no Gemini health in /health)';
    default:
      return code;
  }
}

export function buildRecommendedActions(input: {
  workerConfigured: boolean;
  workerReachable: boolean;
  gemini: GeminiWorkerHealth | null;
  workerVersion: string | null;
  openAiStreak: number;
  recentFallbackCount: number;
}): string[] {
  const actions: string[] = [];

  if (!input.workerConfigured) {
    actions.push('Add WORKER_URL to tools/admin/.env (terraform output worker_url).');
  }
  if (input.workerConfigured && !input.workerReachable) {
    actions.push('Run: gcloud auth application-default login');
    actions.push('Confirm your GCP user has roles/run.invoker on the worker service.');
  }
  if (input.gemini?.status === 'unknown') {
    actions.push('Deploy the latest worker — current prod build has no Gemini health endpoint.');
  }
  if (input.gemini?.status === 'unavailable') {
    if (input.gemini.errorCode === 'model_not_found') {
      actions.push('Set GEMINI_MODEL=gemini-2.5-flash in worker env and redeploy.');
    } else {
      actions.push('Check worker Cloud Logging for "Gemini failed, falling back to OpenAI".');
    }
  }
  if (input.openAiStreak > 0 && input.gemini?.status !== 'ok') {
    actions.push(
      `Last ${input.openAiStreak} processed invoice(s) used OpenAI — Gemini is not handling traffic.`
    );
  }
  if (input.recentFallbackCount === 0 && input.openAiStreak > 0) {
    actions.push(
      'Fallback reasons are stored on new worker deploys only — older OpenAI rows won’t have a reason in Firestore.'
    );
  }
  if (actions.length === 0 && input.gemini?.status === 'ok') {
    actions.push('No action needed — Gemini is healthy.');
  }

  return actions;
}

function isoFromFirestore(value: unknown): string | null {
  if (!value) {
    return null;
  }
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : null;
}

export { humanizeGeminiStatus, humanizeErrorCode };

export class AlertsService {
  constructor(private firestore: Firestore) {}

  async getAlerts(): Promise<AlertsResponse> {
    const workerUrl = process.env.WORKER_URL?.replace(/\/$/, '') || '';
    const workerConfigured = Boolean(workerUrl);

    const [geminiHealth, jobAlerts] = await Promise.all([
      this.fetchWorkerGeminiHealth(workerUrl),
      this.collectJobAlerts(),
    ]);

    const alerts: SystemAlert[] = [...jobAlerts.alerts];

    if (workerConfigured && !geminiHealth.reachable) {
      alerts.unshift({
        id: 'worker-unreachable',
        severity: 'critical',
        type: 'worker_unreachable',
        title: 'Worker service unreachable',
        message:
          geminiHealth.authError ||
          `Could not reach worker at ${workerUrl}. Check WORKER_URL and network.`,
        timestamp: new Date().toISOString(),
      });
    } else if (!workerConfigured) {
      alerts.push({
        id: 'worker-url-missing',
        severity: 'info',
        type: 'worker_url_missing',
        title: 'Worker URL not configured',
        message:
          'Add WORKER_URL to tools/admin/.env to monitor live Gemini health from production worker.',
        timestamp: null,
      });
    } else if (geminiHealth.gemini?.status === 'unavailable') {
      alerts.unshift({
        id: 'gemini-unavailable',
        severity: 'critical',
        type: 'gemini_unavailable',
        title: 'Gemini is unavailable',
        message: summarizeFallbackReason(
          geminiHealth.gemini.errorMessage || geminiHealth.gemini.errorCode
        ),
        timestamp: geminiHealth.gemini.checkedAt,
        metadata: {
          model: geminiHealth.gemini.model,
          errorCode: geminiHealth.gemini.errorCode,
        },
      });
    } else if (geminiHealth.gemini?.status === 'unconfigured') {
      alerts.push({
        id: 'gemini-unconfigured',
        severity: 'warning',
        type: 'gemini_unconfigured',
        title: 'Gemini not configured on worker',
        message: 'Worker has no GEMINI_API_KEY — all invoices use OpenAI.',
        timestamp: geminiHealth.gemini.checkedAt,
      });
    } else if (geminiHealth.gemini?.status === 'unknown') {
      alerts.unshift({
        id: 'gemini-health-unknown',
        severity: 'warning',
        type: 'gemini_health_unknown',
        title: 'Worker does not report Gemini health',
        message:
          'Production worker is reachable but missing the gemini field on /health. Deploy the latest worker to enable live monitoring and fallback tracking.',
        timestamp: new Date().toISOString(),
        metadata: { workerVersion: geminiHealth.workerVersion },
      });
    }

    if (
      jobAlerts.openAiStreak >= 1 &&
      geminiHealth.gemini?.status !== 'ok' &&
      geminiHealth.gemini?.status !== 'unconfigured'
    ) {
      alerts.push({
        id: 'openai-streak-gemini-down',
        severity: jobAlerts.openAiStreak >= 3 ? 'critical' : 'warning',
        type: 'openai_streak',
        title: `Last ${jobAlerts.openAiStreak} invoice(s) used OpenAI`,
        message:
          jobAlerts.openAiStreak === 1
            ? 'The most recent processed invoice used OpenAI instead of Gemini.'
            : `The last ${jobAlerts.openAiStreak} processed invoices all used OpenAI — Gemini is likely failing silently.`,
        timestamp: jobAlerts.lastJobAt,
        metadata: { openAiStreak: jobAlerts.openAiStreak },
      });
    } else if (jobAlerts.openAiStreak >= 5 && geminiHealth.gemini?.status === 'ok') {
      alerts.push({
        id: 'openai-streak',
        severity: 'warning',
        type: 'openai_streak',
        title: 'Recent invoices all used OpenAI',
        message: `Last ${jobAlerts.openAiStreak} processed jobs used OpenAI despite Gemini reporting healthy. Check worker logs for silent fallbacks before these jobs were tracked.`,
        timestamp: jobAlerts.lastJobAt,
      });
    }

    alerts.sort((a, b) => {
      const severityOrder: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
      const diff = severityOrder[a.severity] - severityOrder[b.severity];
      if (diff !== 0) {
        return diff;
      }
      return (b.timestamp || '').localeCompare(a.timestamp || '');
    });

    const criticalCount = alerts.filter((a) => a.severity === 'critical').length;
    const warningCount = alerts.filter((a) => a.severity === 'warning').length;

    const geminiMonitoringSupported = geminiHealth.gemini?.status !== 'unknown';
    const recommendedActions = buildRecommendedActions({
      workerConfigured,
      workerReachable: geminiHealth.reachable,
      gemini: geminiHealth.gemini,
      workerVersion: geminiHealth.workerVersion,
      openAiStreak: jobAlerts.openAiStreak,
      recentFallbackCount: jobAlerts.recentFallbacks.length,
    });

    return {
      summary: {
        alertCount: alerts.filter((a) => a.severity !== 'info').length,
        criticalCount,
        warningCount,
        hasIssues: criticalCount > 0 || warningCount > 0,
      },
      gemini: geminiHealth.gemini,
      workerConfigured,
      workerReachable: geminiHealth.reachable,
      workerVersion: geminiHealth.workerVersion,
      diagnostics: {
        workerUrl: workerConfigured ? workerUrl : null,
        workerReachable: geminiHealth.reachable,
        workerVersion: geminiHealth.workerVersion,
        geminiMonitoringSupported,
        recommendedActions,
      },
      llmStats: jobAlerts.llmStats,
      alerts,
      recentFallbacks: jobAlerts.recentFallbacks,
      recentLlmJobs: jobAlerts.recentLlmJobs,
      timestamp: new Date().toISOString(),
    };
  }

  private async fetchWorkerGeminiHealth(workerUrl: string): Promise<{
    reachable: boolean;
    gemini: GeminiWorkerHealth | null;
    workerVersion: string | null;
    authError?: string;
  }> {
    if (!workerUrl) {
      return { reachable: false, gemini: null, workerVersion: null };
    }

    try {
      const auth = new GoogleAuth();
      const client = await auth.getIdTokenClient(workerUrl);

      const response = await client.request<{ gemini?: GeminiWorkerHealth; version?: string }>({
        url: `${workerUrl}/health`,
        timeout: 8000,
      });

      const workerVersion = response.data?.version ?? null;
      const gemini = response.data?.gemini;
      if (!gemini) {
        return {
          reachable: true,
          workerVersion,
          gemini: {
            status: 'unknown',
            model: null,
            checkedAt: null,
            errorCode: 'health_endpoint_legacy',
            errorMessage: 'Worker /health has no gemini block — deploy latest worker',
          },
        };
      }

      return {
        reachable: true,
        workerVersion,
        gemini: {
          status: gemini.status || 'unknown',
          model: gemini.model ?? null,
          checkedAt: gemini.checkedAt ?? null,
          errorCode: gemini.errorCode ?? null,
          errorMessage: gemini.errorMessage ?? null,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isAuth =
        message.includes('403') ||
        message.includes('401') ||
        message.toLowerCase().includes('permission');

      return {
        reachable: false,
        gemini: null,
        workerVersion: null,
        authError: isAuth
          ? 'Could not authenticate to worker — run gcloud auth application-default login and ensure roles/run.invoker'
          : message,
      };
    }
  }

  private async collectJobAlerts(): Promise<{
    alerts: SystemAlert[];
    recentFallbacks: LlmFallbackEvent[];
    recentLlmJobs: RecentLlmJob[];
    llmStats: LlmUsageStats;
    openAiStreak: number;
    lastJobAt: string | null;
  }> {
    const snapshot = await this.firestore
      .collection(INVOICE_JOBS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(JOB_SCAN_LIMIT)
      .get();

    const now = Date.now();
    const fallbackCutoff = now - FALLBACK_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
    const failedCutoff = now - FAILED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

    const alerts: SystemAlert[] = [];
    const recentFallbacks: LlmFallbackEvent[] = [];
    const recentLlmJobs: RecentLlmJob[] = [];
    let openAiStreak = 0;
    let lastJobAt: string | null = null;
    let geminiCount = 0;
    let openaiCount = 0;
    let unknownProviderCount = 0;
    let processedCount = 0;
    let lastGeminiAt: string | null = null;
    let lastOpenAiAt: string | null = null;

    for (const doc of snapshot.docs) {
      const d = doc.data();
      const createdAt = isoFromFirestore(d.createdAt);
      const createdMs = toMillis(d.createdAt);

      if (!lastJobAt && createdAt) {
        lastJobAt = createdAt;
      }

      if (d.status === 'processed') {
        processedCount++;
        if (d.llmProvider === 'gemini') {
          geminiCount++;
          if (!lastGeminiAt && createdAt) {
            lastGeminiAt = createdAt;
          }
        } else if (d.llmProvider === 'openai') {
          openaiCount++;
          if (!lastOpenAiAt && createdAt) {
            lastOpenAiAt = createdAt;
          }
        } else {
          unknownProviderCount++;
        }

        if (recentLlmJobs.length < 15) {
          recentLlmJobs.push({
            jobId: doc.id,
            vendorName: d.vendorName ?? null,
            chatTitle: d.chatTitle || '',
            llmProvider: d.llmProvider ?? null,
            llmFallbackFrom: d.llmFallbackFrom ?? null,
            llmFallbackReason: d.llmFallbackReason ?? null,
            status: d.status,
            createdAt,
          });
        }
      }

      if (d.llmFallbackFrom === 'gemini' && createdMs >= fallbackCutoff) {
        recentFallbacks.push({
          jobId: doc.id,
          vendorName: d.vendorName ?? null,
          chatTitle: d.chatTitle || '',
          llmProvider: d.llmProvider ?? null,
          fallbackReason: d.llmFallbackReason ?? null,
          receivedAt: d.receivedAt || '',
          createdAt,
        });
      }

      if (d.status === 'failed' && createdMs >= failedCutoff) {
        alerts.push({
          id: `failed-${doc.id}`,
          severity: 'warning',
          type: 'job_failed',
          title: 'Invoice processing failed',
          message: d.lastError || `Job failed at step ${d.lastStep || 'unknown'}`,
          timestamp: createdAt,
          metadata: {
            jobId: doc.id,
            chatTitle: d.chatTitle,
            lastStep: d.lastStep,
          },
        });
      }
    }

    for (const doc of snapshot.docs) {
      const d = doc.data();
      if (d.status !== 'processed') {
        continue;
      }
      if (d.llmProvider === 'openai') {
        openAiStreak++;
      } else {
        break;
      }
    }

    if (recentFallbacks.length > 0) {
      const latest = recentFallbacks[0];
      alerts.push({
        id: 'llm-fallback-recent',
        severity: 'warning',
        type: 'llm_fallback',
        title: `${recentFallbacks.length} Gemini fallback(s) in last ${FALLBACK_LOOKBACK_DAYS} days`,
        message: summarizeFallbackReason(latest.fallbackReason),
        timestamp: latest.createdAt,
        metadata: { count: recentFallbacks.length },
      });
    }

    return {
      alerts,
      recentFallbacks,
      recentLlmJobs,
      llmStats: {
        scannedJobs: snapshot.size,
        processedCount,
        geminiCount,
        openaiCount,
        unknownProviderCount,
        openAiStreak,
        lastGeminiAt,
        lastOpenAiAt,
      },
      openAiStreak,
      lastJobAt,
    };
  }
}
