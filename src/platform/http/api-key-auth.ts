import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedError } from '../errors.js';
import { config } from '../config/index.js';

export function apiKeyAuth(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const apiKey = config.auth.apiKey;
  const provided = req.headers['x-api-key'];

  if (typeof provided !== 'string' || provided.length === 0) {
    next(new UnauthorizedError());
    return;
  }

  const configuredBuf = Buffer.from(apiKey);
  const providedBuf = Buffer.from(provided);

  if (
    configuredBuf.length !== providedBuf.length ||
    !timingSafeEqual(configuredBuf, providedBuf)
  ) {
    next(new UnauthorizedError());
    return;
  }

  next();
}
