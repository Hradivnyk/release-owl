const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env variable: ${key}`);
  return value;
};

const optional = (key: string, defaultValue: string): string => {
  return process.env[key] ?? defaultValue;
};

const optionalInt = (key: string, defaultValue: number): number => {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`Env variable ${key} must be an integer, got: "${raw}"`);
  return parsed;
};

const positiveInt = (key: string, defaultValue: number): number => {
  const raw = process.env[key];
  const value = raw !== undefined ? Number.parseInt(raw, 10) : defaultValue;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Env variable ${key} must be a positive integer, got: ${raw ?? defaultValue}`,
    );
  }
  return value;
};

const nodeEnv = optional('NODE_ENV', 'development');

export const config = {
  server: {
    port: optionalInt('PORT', 3000),
    nodeEnv,
    isDev: nodeEnv === 'development',
    isProd: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    logLevel: optional(
      'LOG_LEVEL',
      nodeEnv === 'test'
        ? 'silent'
        : nodeEnv === 'development'
          ? 'debug'
          : 'info',
    ),
  },
  db: {
    url: required('DATABASE_URL'),
  },
  github: {
    token: optional('GITHUB_TOKEN', ''),
  },
  rabbitmq: {
    url: optional('RABBITMQ_URL', 'amqp://localhost:5672'),
  },
  app: {
    baseUrl: optional('BASE_URL', 'http://localhost:3000'),
    allowedOrigin: optional('ALLOWED_ORIGIN', '*'),
  },
  scanner: {
    cronSchedule: optional('SCANNER_CRON_SCHEDULE', '0 * * * *'),
  },
  outbox: {
    pollIntervalMs: positiveInt('OUTBOX_POLL_INTERVAL_MS', 1000),
    batchSize: positiveInt('OUTBOX_BATCH_SIZE', 50),
  },
  saga: {
    // How often the sweeper checks for stuck sagas (ms).
    sweepIntervalMs: positiveInt('SAGA_SWEEP_INTERVAL_MS', 5 * 60 * 1000),
    // Sagas older than this threshold in status='started' are considered stuck.
    timeoutMs: positiveInt('SAGA_TIMEOUT_MS', 30 * 60 * 1000),
  },
  auth: {
    apiKey: required('API_KEY'),
  },
} as const;
