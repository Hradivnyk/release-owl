// Minimum env vars required by notification service's config.ts for unit tests.
// The DATABASE_URL isn't used in unit tests (all DB interactions are mocked),
// but config.ts calls required('DATABASE_URL') at module load time.
process.env.DATABASE_URL =
  'postgres://test:test@localhost:5432/notification_test';
process.env.SMTP_HOST = 'localhost';
process.env.SMTP_USER = 'test';
process.env.SMTP_PASS = 'test';
process.env.SMTP_FROM = 'test@example.com';
process.env.NODE_ENV = 'test';
