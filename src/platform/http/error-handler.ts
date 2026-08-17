import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors.js';
import logger from '../logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const log = req.log ?? logger;
  if (err instanceof ZodError) {
    log.warn(
      { event: 'error.validation', issues: err.issues },
      'Request validation failed',
    );
    res.status(400).json({ error: err.issues[0].message });
    return;
  }
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      log.error({ event: 'error.app_error', err }, err.message);
    }
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  log.error({ event: 'error.unhandled', err }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
