import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pino from 'pino';
import { config } from './config/index.js';
import { requestContext } from '../utils/requestContext.js';

export interface ILogger {
  info(objOrMsg: object | string, msg?: string): void;
  warn(objOrMsg: object | string, msg?: string): void;
  debug(objOrMsg: object | string, msg?: string): void;
  error(objOrMsg: object | string, msg?: string): void;
}

const { name, version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8'),
) as { name: string; version: string };

const baseLogger = pino({
  level: config.server.logLevel,

  base: {
    service: name,
    version,
    env: config.server.nodeEnv,
  },

  formatters: {
    level: (label) => ({ level: label }),
  },

  // pino-pretty only in development — in production clean JSON
  transport: config.server.isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

const LOG_METHODS = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
] as const;
type LogMethod = (typeof LOG_METHODS)[number];
type PinoLogFn = (...args: unknown[]) => void;

// Proxy that auto-injects requestId from AsyncLocalStorage into every log call,
// so service-layer logs are traceable in Kibana without passing requestId explicitly.
const logger = new Proxy(baseLogger, {
  get(target, prop: string | symbol): unknown {
    if (
      typeof prop === 'string' &&
      (LOG_METHODS as readonly string[]).includes(prop)
    ) {
      return (mergeObjectOrMsg: unknown, ...rest: unknown[]): void => {
        const requestId = requestContext.getStore();
        // Without this widening, TypeScript applies pino.LogFn's strict overloads
        // and rejects `unknown` arguments in the .call() invocations below.
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        const fn = target[prop as LogMethod] as PinoLogFn;
        if (!requestId) {
          fn.call(target, mergeObjectOrMsg, ...rest);
          return;
        }
        if (mergeObjectOrMsg !== null && typeof mergeObjectOrMsg === 'object') {
          fn.call(target, { requestId, ...mergeObjectOrMsg }, ...rest);
          return;
        }
        fn.call(target, { requestId }, mergeObjectOrMsg, ...rest);
      };
    }
    const value: unknown = (
      target as unknown as Record<string | symbol, unknown>
    )[prop];
    if (typeof value === 'function') {
      return (value as PinoLogFn).bind(target);
    }
    return value;
  },
});

export default logger;
