import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { config } from './config.js';

export interface ILogger {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
  debug(obj: object, msg?: string): void;
}

const { name, version } = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8'),
) as { name: string; version: string };

const logger = pino({
  level: config.logLevel,
  base: { service: name, version, env: config.nodeEnv },
  formatters: {
    level: (label) => ({ level: label }),
  },
  transport: config.isDev
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

export default logger;
