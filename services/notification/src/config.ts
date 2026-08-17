const required = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env variable: ${key}`);
  return value;
};

const optional = (key: string, defaultValue: string): string =>
  process.env[key] ?? defaultValue;

const optionalInt = (key: string, defaultValue: number): number => {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed))
    throw new Error(`Env variable ${key} must be an integer, got: "${raw}"`);
  return parsed;
};

const optionalPositiveInt = (key: string, defaultValue: number): number => {
  const value = optionalInt(key, defaultValue);
  if (value < 1)
    throw new Error(
      `Env variable ${key} must be >= 1, got: ${value.toString()}`,
    );
  return value;
};

const nodeEnv = optional('NODE_ENV', 'development');

export const config = {
  nodeEnv,
  isDev: nodeEnv === 'development',
  isTest: nodeEnv === 'test',
  logLevel: optional(
    'LOG_LEVEL',
    nodeEnv === 'test'
      ? 'silent'
      : nodeEnv === 'development'
        ? 'debug'
        : 'info',
  ),
  db: {
    url: required('DATABASE_URL'),
  },
  email: {
    host: required('SMTP_HOST'),
    port: optionalInt('SMTP_PORT', 587),
    user: required('SMTP_USER'),
    pass: required('SMTP_PASS'),
    from: required('SMTP_FROM'),
  },
  app: {
    baseUrl: optional('BASE_URL', 'http://localhost:3000'),
  },
  retry: {
    attempts: optionalPositiveInt('EMAIL_RETRY_ATTEMPTS', 3),
    backoffMs: optionalInt('EMAIL_RETRY_BACKOFF_MS', 500),
  },
  rabbitmq: {
    url: optional('RABBITMQ_URL', 'amqp://localhost:5672'),
  },
  health: {
    port: optionalInt('HEALTH_PORT', 3002),
  },
  outbox: {
    pollIntervalMs: optionalInt('OUTBOX_POLL_INTERVAL_MS', 1000),
    batchSize: optionalInt('OUTBOX_BATCH_SIZE', 50),
  },
} as const;
