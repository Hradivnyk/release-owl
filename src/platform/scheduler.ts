import cron from 'node-cron';

/**
 * Port over the cron scheduler. Application services depend on this abstraction
 * instead of importing `node-cron` directly, keeping the scheduling library
 * (infrastructure) out of the domain/application layer. The concrete adapter
 * below is wired in the composition root.
 */
export interface Scheduler {
  /** Run `task` on every tick of the given cron expression. */
  schedule(cronExpression: string, task: () => void): void;
}

export class NodeCronScheduler implements Scheduler {
  schedule(cronExpression: string, task: () => void): void {
    if (!cron.validate(cronExpression)) {
      throw new Error(
        `Invalid cron schedule: "${cronExpression}". Check SCANNER_CRON_SCHEDULE in your .env file.`,
      );
    }

    cron.schedule(cronExpression, task);
  }
}
