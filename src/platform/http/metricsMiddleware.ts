import type { NextFunction, Request, Response } from 'express';

import {
  httpRequestDurationSeconds,
  httpRequestsTotal,
} from '../../metrics/index.js';

function normaliseRoute(req: Request): string {
  const route = req.route as { path?: string } | undefined;
  if (route?.path) {
    return (req.baseUrl ?? '') + route.path;
  }
  // Mounted middleware (e.g. /api/docs via app.use): baseUrl holds the mount path
  if (req.baseUrl) {
    return req.baseUrl;
  }
  // Static files, 404s, pre-route middleware — bucket to prevent cardinality explosion
  return 'unknown';
}

export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.path === '/metrics') {
    next();
    return;
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const labels = {
      method: req.method,
      route: normaliseRoute(req),
      status_code: String(res.statusCode),
    };
    httpRequestsTotal.inc(labels);
    httpRequestDurationSeconds.observe(labels, durationSeconds);
  });

  next();
}
