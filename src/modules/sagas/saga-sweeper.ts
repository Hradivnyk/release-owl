import type { ILogger } from '@release-owl/platform';
import type { ISagaModel } from './subscription-saga.model.js';
import type { SubscriptionSagaOrchestrator } from './subscription-saga.orchestrator.js';

export interface SagaSweeperConfig {
  /** How often to scan for stuck sagas (ms). */
  intervalMs: number;
  /** Sagas older than this threshold in status='started' are considered stuck (ms). */
  timeoutMs: number;
}

/**
 * Periodically finds sagas that have been in status='started' longer than
 * `timeoutMs` and compensates them by calling onEmailFailed on the orchestrator.
 *
 * This handles the edge case where the notification service published a command
 * via outbox but never sent a reply (e.g. the broker dropped the message before
 * the notification consumer received it). Without the sweeper such sagas would
 * stay in 'started' indefinitely, leaving a dangling pending subscription.
 *
 * Compensation is idempotent: if the saga has already been completed or
 * compensated by the time the sweep runs, the orchestrator is a no-op.
 */
export class SagaSweeper {
  private timer: NodeJS.Timeout | null = null;
  private sweeping = false;

  constructor(
    private readonly sagaModel: ISagaModel,
    private readonly orchestrator: SubscriptionSagaOrchestrator,
    private readonly logger: ILogger,
    private readonly config: SagaSweeperConfig,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);
    this.timer.unref();
    this.logger.info(
      {
        event: 'saga.sweeper_started',
        intervalMs: this.config.intervalMs,
        timeoutMs: this.config.timeoutMs,
      },
      'Saga sweeper started',
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error(
        { event: 'saga.sweep_failed', err },
        'Saga sweep failed',
      );
    } finally {
      this.sweeping = false;
    }
  }

  // Exposed for deterministic testing and manual triggering.
  async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - this.config.timeoutMs);
    const stuck = await this.sagaModel.findStartedOlderThan(cutoff);

    if (stuck.length === 0) return;

    this.logger.warn(
      { event: 'saga.sweep_found', count: stuck.length },
      `Saga sweeper found ${stuck.length.toString()} stuck saga(s) — compensating`,
    );

    for (const saga of stuck) {
      try {
        // eslint-disable-next-line no-await-in-loop -- sequential compensation by design
        await this.orchestrator.onEmailFailed(
          saga.id,
          'saga timeout — no reply received from notification service',
        );
      } catch (err) {
        // Log and continue: one failed compensation must not block the rest.
        this.logger.error(
          { event: 'saga.sweep_compensation_failed', sagaId: saga.id, err },
          'Failed to compensate stuck saga',
        );
      }
    }
  }
}
