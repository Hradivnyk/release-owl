import type { IBroker, ILogger } from '@release-owl/platform';
import {
  EmailSentSchema,
  EmailFailedSchema,
  EMAIL_SENT,
  EMAIL_FAILED,
} from '@release-owl/contracts';
import type { SubscriptionSagaOrchestrator } from './subscription-saga.orchestrator.js';

// Durable queues that bind to the reply routing keys on the shared topic exchange.
const QUEUE_EMAIL_SENT = 'app.email-sent';
const QUEUE_EMAIL_FAILED = 'app.email-failed';

/**
 * Consumes saga reply events published by the notification service and forwards
 * them to the orchestrator. Each handler is idempotent (the orchestrator checks
 * saga status before acting), so at-least-once redelivery is safe.
 */
export class SagaReplyConsumer {
  private started = false;

  constructor(
    private readonly broker: IBroker,
    private readonly orchestrator: SubscriptionSagaOrchestrator,
    private readonly logger: ILogger,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    await this.broker.subscribe(
      QUEUE_EMAIL_SENT,
      EMAIL_SENT,
      async (raw): Promise<void> => {
        const payload = EmailSentSchema.parse(raw);
        this.logger.info(
          { event: 'saga.reply.email_sent', sagaId: payload.saga_id },
          'Received email.sent reply',
        );
        await this.orchestrator.onEmailSent(payload.saga_id);
      },
    );

    await this.broker.subscribe(
      QUEUE_EMAIL_FAILED,
      EMAIL_FAILED,
      async (raw): Promise<void> => {
        const payload = EmailFailedSchema.parse(raw);
        this.logger.info(
          { event: 'saga.reply.email_failed', sagaId: payload.saga_id },
          'Received email.failed reply',
        );
        await this.orchestrator.onEmailFailed(payload.saga_id, payload.reason);
      },
    );
  }
}
