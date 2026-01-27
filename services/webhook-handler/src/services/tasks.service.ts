/**
 * Cloud Tasks service for enqueueing worker jobs
 * Supports local development mode via SKIP_CLOUD_TASKS env var
 */

import { CloudTasksClient, protos } from '@google-cloud/tasks';
import type {
  TaskPayload,
  CallbackPayload,
  InvoiceCommandPayload,
  InvoiceMessagePayload,
  InvoiceCallbackPayload,
  ReportCommandPayload,
} from '../../../../shared/types';
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
 * Build a Cloud Task for worker endpoint
 */
function buildCloudTask(
  taskName: string,
  endpoint: string,
  payload: unknown,
  config: Config
): protos.google.cloud.tasks.v2.ITask {
  return {
    name: taskName,
    httpRequest: {
      httpMethod: 'POST',
      url: `${config.workerUrl}${endpoint}`,
      headers: {
        'Content-Type': 'application/json',
      },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      oidcToken: {
        serviceAccountEmail: config.serviceAccountEmail,
        audience: config.workerUrl,
      },
    },
  };
}

/**
 * Create a Cloud Task to process an invoice
 */
export async function enqueueProcessingTask(payload: TaskPayload, config: Config): Promise<string> {
  const client = getClient();

  const parent = client.queuePath(config.projectId, config.location, config.queueName);

  // Create a unique task name to prevent duplicates
  const taskName = `${parent}/tasks/invoice-${payload.chatId}-${payload.messageId}`;

  const task = buildCloudTask(taskName, '/process', payload, config);

  try {
    const [response] = await client.createTask({
      parent,
      task,
    });

    logger.info({ taskName: response.name }, 'Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    // Handle duplicate task error (task already exists)
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 6) {
      logger.info({ taskName }, 'Task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}

/**
 * Create a Cloud Task to process a callback query
 */
export async function enqueueCallbackTask(
  payload: CallbackPayload,
  config: Config
): Promise<string> {
  const client = getClient();

  const parent = client.queuePath(config.projectId, config.location, config.queueName);

  // Create a unique task name to prevent duplicates
  const taskName = `${parent}/tasks/callback-${payload.callbackQueryId}`;

  const task = buildCloudTask(taskName, '/callback', payload, config);

  try {
    const [response] = await client.createTask({
      parent,
      task,
    });

    logger.info({ taskName: response.name }, 'Callback Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    // Handle duplicate task error (task already exists)
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 6) {
      logger.info({ taskName }, 'Callback task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}

// ============================================================================
// Invoice Generation Tasks
// ============================================================================

/**
 * Generic function to create invoice Cloud Task
 */
async function enqueueInvoiceTask(
  endpoint: string,
  taskNameSuffix: string,
  payload: InvoiceCommandPayload | InvoiceMessagePayload | InvoiceCallbackPayload,
  config: Config
): Promise<string> {
  const client = getClient();

  const parent = client.queuePath(config.projectId, config.location, config.queueName);

  const taskName = `${parent}/tasks/invoice-${endpoint}-${taskNameSuffix}`;

  const task = buildCloudTask(taskName, `/invoice/${endpoint}`, payload, config);

  try {
    const [response] = await client.createTask({
      parent,
      task,
    });

    logger.info({ taskName: response.name }, 'Invoice Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 6) {
      logger.info({ taskName }, 'Invoice task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}

/**
 * Enqueue /invoice command for processing
 */
export async function enqueueInvoiceCommandTask(
  payload: InvoiceCommandPayload,
  config: Config
): Promise<string> {
  return enqueueInvoiceTask('command', `${payload.chatId}-${payload.messageId}`, payload, config);
}

/**
 * Enqueue invoice conversation message for processing
 */
export async function enqueueInvoiceMessageTask(
  payload: InvoiceMessagePayload,
  config: Config
): Promise<string> {
  return enqueueInvoiceTask('message', `${payload.chatId}-${payload.messageId}`, payload, config);
}

/**
 * Enqueue invoice callback (button press) for processing
 */
export async function enqueueInvoiceCallbackTask(
  payload: InvoiceCallbackPayload,
  config: Config
): Promise<string> {
  return enqueueInvoiceTask('callback', payload.callbackQueryId, payload, config);
}

// ============================================================================
// Onboarding Task Enqueueing
// ============================================================================

/**
 * Enqueue onboarding task (command, message, or callback)
 */
async function enqueueOnboardingTask(
  endpoint: string,
  taskNameSuffix: string,
  payload: InvoiceCommandPayload | InvoiceMessagePayload | InvoiceCallbackPayload,
  config: Config
): Promise<string> {
  const client = getClient();

  const parent = client.queuePath(config.projectId, config.location, config.queueName);

  const taskName = `${parent}/tasks/onboard-${endpoint}-${taskNameSuffix}`;

  const task = buildCloudTask(taskName, `/onboard/${endpoint}`, payload, config);

  try {
    const [response] = await client.createTask({
      parent,
      task,
    });

    logger.info({ taskName: response.name }, 'Onboarding Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 6) {
      logger.info({ taskName }, 'Onboarding task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}

/**
 * Enqueue /onboard command for processing
 */
export async function enqueueOnboardCommandTask(
  payload: InvoiceCommandPayload,
  config: Config
): Promise<string> {
  return enqueueOnboardingTask(
    'command',
    `${payload.chatId}-${payload.messageId}`,
    payload,
    config
  );
}

/**
 * Enqueue onboarding conversation message for processing
 */
export async function enqueueOnboardMessageTask(
  payload: InvoiceMessagePayload,
  config: Config
): Promise<string> {
  return enqueueOnboardingTask(
    'message',
    `${payload.chatId}-${payload.messageId}`,
    payload,
    config
  );
}

/**
 * Enqueue onboarding callback (button press) for processing
 */
export async function enqueueOnboardCallbackTask(
  payload: InvoiceCallbackPayload,
  config: Config
): Promise<string> {
  return enqueueOnboardingTask('callback', payload.callbackQueryId, payload, config);
}

/**
 * Enqueue onboarding photo/document (logo upload) for processing
 */
export async function enqueueOnboardingPhotoTask(
  payload: TaskPayload,
  config: Config
): Promise<string> {
  const client = getClient();

  const parent = client.queuePath(config.projectId, config.location, config.queueName);

  const taskName = `${parent}/tasks/onboard-photo-${payload.chatId}-${payload.messageId}`;

  const task = buildCloudTask(taskName, '/onboard/photo', payload, config);

  try {
    const [response] = await client.createTask({
      parent,
      task,
    });

    logger.info({ taskName: response.name }, 'Onboarding photo Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 6) {
      logger.info({ taskName }, 'Onboarding photo task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}

// ============================================================================
// Report Tasks
// ============================================================================

/**
 * Enqueue report command task for worker processing
 */
export async function enqueueReportCommandTask(
  payload: ReportCommandPayload,
  config: Config
): Promise<string> {
  const endpoint = 'command';
  const taskNameSuffix = `${payload.chatId}-${payload.messageId}`;
  const client = getClient();
  const parent = client.queuePath(config.projectId, config.location, config.queueName);
  const taskName = `${parent}/tasks/report-${endpoint}-${taskNameSuffix}`;
  const task = buildCloudTask(taskName, `/report/${endpoint}`, payload, config);

  try {
    const [response] = await client.createTask({ parent, task });
    logger.info({ taskName: response.name }, 'Report Cloud Task created');
    return response.name || taskName;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 6) {
      logger.info({ taskName }, 'Report task already exists (duplicate)');
      return taskName;
    }
    throw error;
  }
}
