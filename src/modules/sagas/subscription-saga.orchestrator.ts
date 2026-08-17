import type { ILogger } from '@release-owl/platform';
import type { IUnitOfWork } from '../../platform/db/unit-of-work.js';
import type { ISubscriptionModel } from '../subscriptions/index.js';
import type { ISagaModel } from './subscription-saga.model.js';

export interface OrchestratorRetryConfig {
  /** How many times to attempt the DB operation before letting the broker nack. */
  attempts: number;
  /** Initial backoff in ms before the second attempt (doubles on each retry). */
  initialDelayMs: number;
}

const DEFAULT_RETRY: OrchestratorRetryConfig = {
  attempts: 3,
  initialDelayMs: 100,
};

/**
 * Handles the two terminal outcomes of the subscribe Saga.
 *
 * Happy path  — email.sent  → markCompleted  (subscription stays pending until
 *               the user clicks the confirmation link, which is outside the saga).
 * Failure path — email.failed → delete the pending subscription + markCompensated
 *               (true undo; frees the (email, repo) unique slot for a re-subscribe).
 *
 * All state transitions run inside a single UoW transaction and are idempotent:
 * if the saga is already terminated the handler is a no-op, so at-least-once
 * message redelivery cannot cause double-compensation.
 *
 * Each handler retries on transient DB failures (network blip, connection pool
 * exhausted). If all attempts fail the error propagates to the broker, which
 * nacks the message; the sweeper will eventually compensate the stuck saga.
 */
export class SubscriptionSagaOrchestrator {
  private readonly retryConfig: OrchestratorRetryConfig;

  constructor(
    private readonly sagaModel: ISagaModel,
    private readonly subscriptionModel: ISubscriptionModel,
    private readonly uow: IUnitOfWork,
    private readonly logger: ILogger,
    retryConfig: OrchestratorRetryConfig = DEFAULT_RETRY,
  ) {
    this.retryConfig = retryConfig;
  }

  private async withRetry<T>(op: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    let delay = this.retryConfig.initialDelayMs;
    for (let attempt = 1; attempt <= this.retryConfig.attempts; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- retries are inherently sequential
        return await op();
      } catch (err) {
        lastErr = err;
        if (attempt < this.retryConfig.attempts) {
          this.logger.warn(
            { event: 'saga.handler.retry', attempt, delay, err },
            'Saga handler failed, retrying',
          );
          // eslint-disable-next-line no-await-in-loop -- backoff sleep between retries
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }
    throw lastErr;
  }

  async onEmailSent(sagaId: string): Promise<void> {
    let completed = false;

    await this.withRetry(async () =>
      this.uow.run(async (trx) => {
        completed = false; // reset on each attempt
        const saga = await this.sagaModel.findById(sagaId, trx);
        if (!saga) {
          this.logger.warn(
            { event: 'saga.reply.unknown', sagaId },
            'Received email.sent for unknown saga — ignoring',
          );
          return;
        }
        if (saga.status !== 'started') {
          // Idempotent: already completed or compensated, nothing to do.
          return;
        }
        await this.sagaModel.markCompleted(sagaId, trx);
        completed = true;
      }),
    );

    if (completed) {
      this.logger.info(
        { event: 'saga.completed', sagaId },
        'Saga completed: confirmation email delivered',
      );
    }
  }

  async onEmailFailed(sagaId: string, reason: string): Promise<void> {
    let subscriptionId: string | null = null;

    await this.withRetry(async () =>
      this.uow.run(async (trx) => {
        subscriptionId = null; // reset on each attempt
        const saga = await this.sagaModel.findById(sagaId, trx);
        if (!saga) {
          this.logger.warn(
            { event: 'saga.reply.unknown', sagaId },
            'Received email.failed for unknown saga — ignoring',
          );
          return;
        }
        if (saga.status !== 'started') {
          // Idempotent: already handled.
          return;
        }
        subscriptionId = saga.subscription_id;
        // Compensation: remove the pending subscription so the user can re-subscribe.
        await this.subscriptionModel.deleteById(saga.subscription_id, trx);
        await this.sagaModel.markCompensated(sagaId, trx);
      }),
    );

    if (subscriptionId !== null) {
      this.logger.info(
        { event: 'saga.compensated', sagaId, subscriptionId, reason },
        'Saga compensated: pending subscription deleted',
      );
    }
  }
}
