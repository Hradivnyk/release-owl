import type { IBroker, ILogger } from '@release-owl/platform';
import type { IUnitOfWork } from '../db/unit-of-work.js';
import type { IOutboxModel } from './outbox.model.js';

export interface OutboxRelayConfig {
  pollIntervalMs: number;
  batchSize: number;
}

/**
 * Drains the transactional outbox: on a timer it claims unpublished reply events
 * (email.sent / email.failed) and publishes them to the broker. Claim, publish
 * and mark-published all happen inside one transaction holding a row lock
 * (SELECT ... FOR UPDATE SKIP LOCKED), so multiple instances never publish the
 * same event, and any publish failure rolls the batch back to be retried on the
 * next tick (at-least-once delivery).
 */
export class OutboxRelay {
  private timer: NodeJS.Timeout | null = null;
  private draining = false;

  constructor(
    private readonly outbox: IOutboxModel,
    private readonly broker: IBroker,
    private readonly uow: IUnitOfWork,
    private readonly logger: ILogger,
    private readonly config: OutboxRelayConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.pollIntervalMs);
    // The relay must not keep the process alive on its own during shutdown.
    this.timer.unref();
    this.logger.info(
      { event: 'outbox.relay_started', intervalMs: this.config.pollIntervalMs },
      'Outbox relay started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // Skips a tick if the previous drain is still running (slow broker / big backlog).
  private async tick(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      await this.drain();
    } catch (err) {
      this.logger.error(
        { event: 'outbox.drain_failed', err },
        'Outbox drain failed',
      );
    } finally {
      this.draining = false;
    }
  }

  // Publishes all currently-pending events in batches. Exposed for tests and for
  // an on-demand, deterministic drain.
  async drain(): Promise<void> {
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- batches are sequential by design
      const published = await this.publishBatch();
      if (published < this.config.batchSize) return;
    }
  }

  private async publishBatch(): Promise<number> {
    return this.uow.run(async (trx) => {
      const rows = await this.outbox.claimUnpublished(
        trx,
        this.config.batchSize,
      );
      for (const row of rows) {
        // eslint-disable-next-line no-await-in-loop -- preserve enqueue order
        await this.broker.publish(row.routing_key, row.payload);
      }
      await this.outbox.markPublished(
        trx,
        rows.map((row) => row.id),
      );
      return rows.length;
    });
  }
}
