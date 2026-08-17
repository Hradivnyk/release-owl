import crypto from 'node:crypto';
import type { IBroker } from '@release-owl/platform';
import { EMAIL_REQUESTED } from '@release-owl/contracts';
import type { Notifier } from './notifier.js';

/**
 * Publishes an `email.requested` event instead of sending mail directly. The
 * standalone notification service consumes the event and performs delivery,
 * decoupling the API from SMTP latency and failures via the message broker.
 */
export class BrokerNotifier implements Notifier {
  constructor(private readonly broker: IBroker) {}

  async sendConfirmationEmail(
    email: string,
    token: string,
    repo: string,
  ): Promise<void> {
    await this.broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: crypto.randomUUID(),
      email,
      repo,
      confirm_token: token,
    });
  }

  async sendNotificationEmail(
    email: string,
    repo: string,
    tag: string,
    token: string,
  ): Promise<void> {
    await this.broker.publish(EMAIL_REQUESTED, {
      type: 'notification',
      event_id: crypto.randomUUID(),
      email,
      repo,
      tag_name: tag,
      unsubscribe_token: token,
    });
  }
}
