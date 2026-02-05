/**
 * Configuration for webhook-handler service
 * Uses Zod for type-safe environment validation
 */

import { z } from 'zod';

/**
 * Environment schema with validation and helpful error messages
 */
const envSchema = z.object({
  PORT: z.string().default('8080').transform(Number),
  GCP_PROJECT_ID: z.string().min(1, { message: 'GCP project ID is required' }),
  GCP_LOCATION: z.string().default('us-central1'),
  QUEUE_NAME: z.string().default('invoice-processing'),
  WORKER_URL: z
    .string()
    .url({ message: 'Worker URL must be a valid URL (e.g., http://localhost:8081)' }),
  WEBHOOK_SECRET_PATH: z
    .string()
    .min(16, {
      message:
        'Webhook secret path must be at least 16 characters. Generate with: openssl rand -hex 16',
    }),
  SERVICE_ACCOUNT_EMAIL: z
    .string()
    .email({ message: 'Service account email must be valid' })
    .optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
});

type EnvSchema = z.infer<typeof envSchema>;

export type Config = {
  port: number;
  projectId: string;
  location: string;
  queueName: string;
  workerUrl: string;
  webhookSecretPath: string;
  serviceAccountEmail: string;
  isDevelopment: boolean;
};

let cachedConfig: Config | null = null;

/**
 * Load and validate configuration using Zod
 * Fails fast with clear error messages if required variables are missing
 */
export function loadConfig(): Config {
  if (cachedConfig) {
    return cachedConfig;
  }

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('\n╔══════════════════════════════════════════════════════════════╗');
    console.error('║                  CONFIGURATION ERROR                          ║');
    console.error('╠══════════════════════════════════════════════════════════════╣');

    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || 'unknown';
      console.error(`║ ✗ ${path}: ${issue.message}`);
    }

    console.error('╠══════════════════════════════════════════════════════════════╣');
    console.error('║ Copy env.example to .env and fill in required values         ║');
    console.error('╚══════════════════════════════════════════════════════════════╝\n');

    throw new Error(`Invalid configuration: ${result.error.issues.length} error(s)`);
  }

  const env: EnvSchema = result.data;
  const isDevelopment = env.NODE_ENV === 'development';

  // In development, service account email is optional
  if (!isDevelopment && !env.SERVICE_ACCOUNT_EMAIL) {
    throw new Error('SERVICE_ACCOUNT_EMAIL is required in production for Cloud Tasks OIDC');
  }

  const config: Config = {
    port: env.PORT,
    projectId: env.GCP_PROJECT_ID,
    location: env.GCP_LOCATION,
    queueName: env.QUEUE_NAME,
    workerUrl: env.WORKER_URL,
    webhookSecretPath: env.WEBHOOK_SECRET_PATH,
    serviceAccountEmail: env.SERVICE_ACCOUNT_EMAIL || '',
    isDevelopment,
  };

  // Log loaded config (without sensitive values)
  console.log('Configuration loaded:');
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Project: ${config.projectId}`);
  console.log(`  - Location: ${config.location}`);
  console.log(`  - Queue: ${config.queueName}`);
  console.log(`  - Worker URL: ${config.workerUrl}`);
  console.log(`  - Development mode: ${config.isDevelopment}`);

  cachedConfig = config;
  return config;
}

/**
 * Get cached configuration (must call loadConfig first)
 */
export function getConfig(): Config {
  if (!cachedConfig) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return cachedConfig;
}
