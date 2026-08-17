import type { ILogger } from '../../platform/logger.js';
import type { Notifier } from './notifier.js';

export interface RestNotifierConfig {
  baseUrl: string;
  timeoutMs: number;
}

/**
 * Sends notification emails via synchronous HTTP POST to the notification
 * service's /api/notify endpoint (recovered from hw7-monolith-microservices).
 *
 * This is the REST baseline kept alongside gRPC for transport comparison.
 * Select it by setting NOTIFIER=rest in the environment.
 *
 * Every email kind goes to a single endpoint with a discriminated payload
 * keyed by `type`, so adding a new email kind never requires a new route.
 *
 * An AbortController timeout prevents a slow notification service from
 * blocking the calling business operation indefinitely.
 */
export class RestNotifier implements Notifier {
  private readonly baseUrl: string;

  constructor(
    private readonly config: RestNotifierConfig,
    private readonly logger: ILogger,
  ) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  async sendConfirmationEmail(
    email: string,
    token: string,
    repo: string,
  ): Promise<void> {
    await this.post({
      type: 'confirmation',
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
    await this.post({
      type: 'notification',
      email,
      repo,
      tag_name: tag,
      unsubscribe_token: token,
    });
  }

  private async post(payload: Record<string, string>): Promise<void> {
    const path = '/api/notify';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(
          `notification service responded with ${response.status.toString()}`,
        );
      }
    } catch (err) {
      this.logger.error(
        { event: 'rest.notify.error', path, err },
        'REST notification request failed',
      );
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
