/**
 * Cloud Tasks service for enqueueing worker jobs
 * Supports local development mode via SKIP_CLOUD_TASKS env var
 */

import { CloudTasksClient, protos } from '@google-cloud/tasks';
import type { TaskPayload, CallbackPayload } from '../../../../shared/types';
import type { Config } from '../config';
import logger from '../logger';

let tasksClient: CloudTasksClient | null = null;

function getClient(): CloudTasksClient {
  if (!tasksClient) {
    tasksClient = new CloudTasksClient();
  }
  return tasksClient;
}

/**
 * Check if running in local development mode
 */
function isLocalMode(): boolean {
  return process.env.SKIP_CLOUD_TASKS === 'true' || process.env.NODE_ENV === 'development';
}

/**
 * Call worker directly for local development
 */
async function callWorkerDirectly(
  payload: TaskPayload,
  workerUrl: string
): Promise<string> {
  logger.info({ workerUrl }, 'Calling worker directly (local mode)');

  const response = await fetch(`${workerUrl}/process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker returned ${response.status}: ${text}`);
  }

  const taskId = `local-${payload.chatId}-${payload.messageId}`;
  logger.info({ taskId }, 'Worker processed task (local mode)');
  return taskId;
}

/**
 * Create a Cloud Task to process an invoice
 * In local mode, calls the worker directly instead
 */
export async function enqueueProcessingTask(
  payload: TaskPayload,
  config: Config
): Promise<string> {
  // Local development mode - call worker directly
  if (isLocalMode()) {
    return callWorkerDirectly(payload, config.workerUrl);
  }

  // Production mode - use Cloud Tasks
  const client = getClient();

  const parent = client.queuePath(
    config.projectId,
    config.location,
    config.queueName
  );

  // Create a unique task name to prevent duplicates
  const taskName = `${parent}/tasks/invoice-${payload.chatId}-${payload.messageId}`;

  const task: protos.google.cloud.tasks.v2.ITask = {
    name: taskName,
    httpRequest: {
      httpMethod: 'POST',
      url: `${config.workerUrl}/process`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      // Use OIDC token for authentication
      oidcToken: {
        serviceAccountEmail: config.serviceAccountEmail,
        audience: config.workerUrl,
      },
    },
  };

  try {
    const [response] = await client.createTask({
      parent,
      task,
    });

    logger.info({ taskName: response.name }, 'Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    // Handle duplicate task error (task already exists)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: number }).code === 6
    ) {
      logger.info({ taskName }, 'Task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}

/**
 * Call worker callback endpoint directly for local development
 */
async function callCallbackDirectly(
  payload: CallbackPayload,
  workerUrl: string
): Promise<string> {
  logger.info({ workerUrl }, 'Calling worker callback directly (local mode)');

  const response = await fetch(`${workerUrl}/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker returned ${response.status}: ${text}`);
  }

  const taskId = `local-callback-${payload.callbackQueryId}`;
  logger.info({ taskId }, 'Worker processed callback (local mode)');
  return taskId;
}

/**
 * Create a Cloud Task to process a callback query
 * In local mode, calls the worker directly instead
 */
export async function enqueueCallbackTask(
  payload: CallbackPayload,
  config: Config
): Promise<string> {
  // Local development mode - call worker directly
  if (isLocalMode()) {
    return callCallbackDirectly(payload, config.workerUrl);
  }

  // Production mode - use Cloud Tasks
  const client = getClient();

  const parent = client.queuePath(
    config.projectId,
    config.location,
    config.queueName
  );

  // Create a unique task name to prevent duplicates
  const taskName = `${parent}/tasks/callback-${payload.callbackQueryId}`;

  const task: protos.google.cloud.tasks.v2.ITask = {
    name: taskName,
    httpRequest: {
      httpMethod: 'POST',
      url: `${config.workerUrl}/callback`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      // Use OIDC token for authentication
      oidcToken: {
        serviceAccountEmail: config.serviceAccountEmail,
        audience: config.workerUrl,
      },
    },
  };

  try {
    const [response] = await client.createTask({
      parent,
      task,
    });

    logger.info({ taskName: response.name }, 'Callback Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    // Handle duplicate task error (task already exists)
    if (
      error instanceof Error &&
      'code' in error &&
      (error as { code: number }).code === 6
    ) {
      logger.info({ taskName }, 'Callback task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}
