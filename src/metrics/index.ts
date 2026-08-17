import client from 'prom-client';

export const register = client.register;

client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

export const httpRequestDurationSeconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const subscriptionOperationsTotal = new client.Counter({
  name: 'subscription_operations_total',
  help: 'Subscription operations by type and result',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

export const githubApiRequestsTotal = new client.Counter({
  name: 'github_api_requests_total',
  help: 'GitHub API requests by operation and result',
  labelNames: ['operation', 'result'] as const,
  registers: [register],
});

export const scannerReleasesDetectedTotal = new client.Counter({
  name: 'scanner_releases_detected_total',
  help: 'New GitHub releases detected by the scanner',
  labelNames: ['repo'] as const,
  registers: [register],
});

export const scannerEmailsSentTotal = new client.Counter({
  name: 'scanner_emails_sent_total',
  help: 'Notification emails sent by the scanner',
  labelNames: ['repo'] as const,
  registers: [register],
});

export const scannerScanDurationSeconds = new client.Histogram({
  name: 'scanner_scan_duration_seconds',
  help: 'Time for a full scanner cycle in seconds',
  labelNames: ['result'] as const,
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120],
  registers: [register],
});
