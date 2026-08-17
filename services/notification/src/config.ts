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

// EMAIL_SENDER controls which IEmailSender implementation is used.
//   smtp — real Nodemailer transport (default; requires SMTP_* env vars)
//   stub — no-op sender for benchmarking (no SMTP creds needed)
const emailSender = optional('EMAIL_SENDER', 'smtp');

// SMTP creds are only required when the real sender is active.
const smtpConfig =
  emailSender === 'stub'
    ? { host: '', port: 587, user: '', pass: '', from: '' }
    : {
        host: required('SMTP_HOST'),
        port: Number.parseInt(optional('SMTP_PORT', '587')),
        user: required('SMTP_USER'),
        pass: required('SMTP_PASS'),
        from: required('SMTP_FROM'),
      };

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
  email: smtpConfig,
  emailSender,
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
  grpc: {
    // Port on which the gRPC server listens inside the container.
    port: Number.parseInt(optional('GRPC_PORT', '50051')),
  },
  rest: {
    // Port on which the synchronous REST server listens inside the container.
    port: Number.parseInt(optional('REST_PORT', '4000')),
  },
  outbox: {
    pollIntervalMs: optionalInt('OUTBOX_POLL_INTERVAL_MS', 1000),
    batchSize: optionalInt('OUTBOX_BATCH_SIZE', 50),
  },
} as const;
