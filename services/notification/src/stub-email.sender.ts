import type { IEmailSender, SendMailOptions } from './email.sender.js';

/**
 * No-op email sender for benchmarking.
 *
 * When EMAIL_SENDER=stub the notification service skips SMTP entirely so that
 * transport latency does not distort the gRPC-vs-REST throughput comparison.
 * Set this in docker-compose before running ghz / autocannon benchmarks.
 */
export class StubEmailSender implements IEmailSender {
  async send(_options: SendMailOptions): Promise<void> {
    // intentionally empty — just resolves immediately
  }
}
