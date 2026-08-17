import type { IEmailSender, SendMailOptions } from './email.sender.js';
import type { ILogger } from './logger.js';

export interface RetryConfig {
  attempts: number;
  backoffMs: number;
}

/**
 * Wraps an {@link IEmailSender} and retries transient SMTP failures with
 * exponential backoff. Since there is no message queue to absorb failures
 * (synchronous HTTP transport), reliability is handled here at the edge that
 * actually talks to the SMTP server.
 */
export class RetryingEmailSender implements IEmailSender {
  constructor(
    private readonly inner: IEmailSender,
    private readonly config: RetryConfig,
    private readonly logger: ILogger,
  ) {}

  async send(options: SendMailOptions): Promise<void> {
    let delay = this.config.backoffMs;
    for (let attempt = 1; attempt <= this.config.attempts; attempt++) {
      try {
        // eslint-disable-next-line no-await-in-loop -- retries are inherently sequential
        await this.inner.send(options);
        return;
      } catch (err) {
        if (attempt >= this.config.attempts) {
          this.logger.error(
            { event: 'email.send_exhausted', attempt, err },
            'Email send retries exhausted',
          );
          throw err;
        }
        this.logger.warn(
          { event: 'email.send_retry', attempt, delay, err },
          `Email send failed, retrying ${attempt.toString()}/${this.config.attempts.toString()}`,
        );
        // eslint-disable-next-line no-await-in-loop -- backoff sleep between retries
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
}
