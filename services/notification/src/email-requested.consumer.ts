import type { IBroker, ILogger } from '@release-owl/platform';
import {
  EMAIL_REQUESTED,
  EmailRequestedPayloadSchema,
} from '@release-owl/contracts';
import type { Notifier } from './email.service.js';

const QUEUE = 'notification.email-requested';

// Bounds the best-effort dedupe cache below. The outbox delivers at-least-once
// (a mid-batch publish failure re-publishes already-acked rows on the next
// tick), so a redelivered event must not cause a second email. This only
// covers duplicates seen within one process lifetime/cache window, not across
// a restart — a full guarantee would need a persisted seen-events store.
const SEEN_EVENT_CACHE_SIZE = 1000;

export class EmailRequestedConsumer {
  private started = false;
  private readonly seenEventIds = new Map<string, true>();

  constructor(
    private readonly broker: IBroker,
    private readonly notifier: Notifier,
    private readonly logger: ILogger,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      await this.broker.subscribe(
        QUEUE,
        EMAIL_REQUESTED,
        async (raw): Promise<void> => {
          const payload = EmailRequestedPayloadSchema.parse(raw);

          if (this.seenEventIds.has(payload.event_id)) {
            this.logger.info(
              {
                event: 'email.duplicate_skipped',
                eventId: payload.event_id,
                repo: payload.repo,
              },
              'Duplicate email-requested event skipped',
            );
            return;
          }

          if (payload.type === 'confirmation') {
            await this.notifier.sendConfirmationEmail(
              payload.email,
              payload.confirm_token,
              payload.repo,
            );
            this.logger.info(
              { event: 'email.confirmation_sent', repo: payload.repo },
              'Confirmation email sent',
            );
          } else {
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

          this.markSeen(payload.event_id);
        },
      );
    } catch (err) {
      this.started = false;
      throw err;
    }
  }

  private markSeen(eventId: string): void {
    this.seenEventIds.set(eventId, true);
    if (this.seenEventIds.size > SEEN_EVENT_CACHE_SIZE) {
      const oldest = this.seenEventIds.keys().next().value;
      if (oldest !== undefined) this.seenEventIds.delete(oldest);
    }
  }
}
