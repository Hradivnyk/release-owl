import type { IBroker } from '@release-owl/platform';
import {
  EMAIL_REQUESTED,
  EmailRequestedPayloadSchema,
  EMAIL_SENT,
  EMAIL_FAILED,
} from '@release-owl/contracts';
import type { ConfirmationEmailRequested } from '@release-owl/contracts';
import type { ILogger } from './logger.js';
import type { Notifier } from './email.service.js';
import type { IOutboxModel } from './outbox/outbox.model.js';
import type { IInboxModel } from './inbox/inbox.model.js';
import type { IUnitOfWork } from './db/unit-of-work.js';

const QUEUE = 'notification.email-requested';

/**
 * Consumes email.requested commands from the app service.
 *
 * Confirmation emails participate in an orchestrated Saga:
 *   1. Idempotency check — skip if the saga_id is already in the inbox (redelivery).
 *   2. Send the email via RetryingEmailSender (handles transient SMTP failures).
 *   3a. Success: atomically mark inbox 'sent' + enqueue email.sent reply in outbox.
 *   3b. Permanent failure: atomically mark inbox 'failed' + enqueue email.failed reply.
 *      The reply is ack-ed normally; the orchestrator in app handles the compensation.
 *
 * Release notification emails (fire-and-forget) are unchanged: a send failure
 * throws so the broker nacks and the message is dropped (no saga, no reply).
 */
export class EmailRequestedConsumer {
  private started = false;
  private stopping = false;

  constructor(
    private readonly broker: IBroker,
    private readonly notifier: Notifier,
    private readonly logger: ILogger,
    private readonly inbox: IInboxModel,
    private readonly outbox: IOutboxModel,
    private readonly uow: IUnitOfWork,
  ) {}

  stop(): void {
    this.stopping = true;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.broker.subscribe(
        QUEUE,
        EMAIL_REQUESTED,
        async (raw): Promise<void> => {
          if (this.stopping) return;
          const payload = EmailRequestedPayloadSchema.parse(raw);

          if (payload.type === 'confirmation') {
            await this.handleConfirmation(payload);
          } else {
            // Release notification: fire-and-forget, no saga
            await this.notifier.sendNotificationEmail(
              payload.email,
              payload.repo,
              payload.tag_name,
              payload.unsubscribe_token,
            );
            this.logger.info(
              { event: 'email.notification_sent', repo: payload.repo },
              'Notification email sent',
            );
          }
        },
      );
    } catch (err) {
      this.started = false;
      throw err;
    }
  }

  private async handleConfirmation(
    payload: ConfirmationEmailRequested,
  ): Promise<void> {
    const { saga_id, email, confirm_token, repo } = payload;

    // Fast pre-check: skip on at-least-once redelivery (idempotent).
    // Even on a duplicate we re-enqueue the reply so the orchestrator receives
    // it even if the outbox relay hadn't published it before the crash that
    // caused the redelivery. The orchestrator's status-guard makes duplicate
    // replies safe.
    if (await this.inbox.wasProcessed(saga_id)) {
      const status = await this.inbox.getStatus(saga_id);
      await this.uow.run(async (trx) => {
        if (status === 'sent') {
          await this.outbox.enqueue(EMAIL_SENT, { saga_id, repo }, trx);
        } else {
          await this.outbox.enqueue(
            EMAIL_FAILED,
            {
              saga_id,
              repo,
              reason: 'previously failed (re-enqueued on duplicate delivery)',
            },
            trx,
          );
        }
      });
      this.logger.info(
        { event: 'email.confirmation_skipped', saga_id, repo, status },
        'Duplicate delivery — reply re-enqueued, email not resent',
      );
      return;
    }

    let emailSent = false;
    try {
      await this.notifier.sendConfirmationEmail(email, confirm_token, repo);
      emailSent = true;

      // Atomically record the outcome and enqueue the reply event.
      await this.uow.run(async (trx) => {
        await this.inbox.markProcessed(saga_id, 'sent', trx);
        await this.outbox.enqueue(EMAIL_SENT, { saga_id, repo }, trx);
      });
      this.logger.info(
        { event: 'email.confirmation_sent', saga_id, repo },
        'Confirmation email sent',
      );
    } catch (err) {
      if (emailSent) {
        // Email reached SMTP but the DB write failed. Rethrow so the broker
        // nacks and redelivers; the next attempt will resend. The risk of a
        // duplicate email is the inherent cost of at-least-once delivery when
        // the external effect (SMTP) can't be rolled back.
        throw err;
      }
      // Retries exhausted: record the failure and publish email.failed so the
      // orchestrator can compensate (delete the pending subscription).
      await this.uow.run(async (trx) => {
        await this.inbox.markProcessed(saga_id, 'failed', trx);
        await this.outbox.enqueue(
          EMAIL_FAILED,
          {
            saga_id,
            repo,
            reason: err instanceof Error ? err.message : String(err),
          },
          trx,
        );
      });
      this.logger.error(
        { event: 'email.confirmation_failed', saga_id, repo, err },
        'Confirmation email failed permanently — compensation triggered',
      );
      // Return normally: failure is handled via outbox reply, not by nacking.
    }
  }
}
