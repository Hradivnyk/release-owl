import { InMemoryBroker } from '@release-owl/platform';
import { EMAIL_SENT, EMAIL_FAILED } from '@release-owl/contracts';
import type { ILogger } from '@release-owl/platform';
import { SagaReplyConsumer } from '../saga-reply.consumer.js';
import type { SubscriptionSagaOrchestrator } from '../subscription-saga.orchestrator.js';

const SAGA_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function fakeOrchestrator(): jest.Mocked<
  Pick<SubscriptionSagaOrchestrator, 'onEmailSent' | 'onEmailFailed'>
> {
  return {
    onEmailSent: jest.fn().mockResolvedValue(undefined),
    onEmailFailed: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SagaReplyConsumer', () => {
  it('routes email.sent to orchestrator.onEmailSent', async () => {
    const broker = new InMemoryBroker();
    const orchestrator = fakeOrchestrator();
    await new SagaReplyConsumer(
      broker,
      orchestrator as unknown as SubscriptionSagaOrchestrator,
      noopLogger,
    ).start();

    await broker.publish(EMAIL_SENT, { saga_id: SAGA_ID, repo: 'owner/repo' });

    expect(orchestrator.onEmailSent).toHaveBeenCalledWith(SAGA_ID);
    expect(orchestrator.onEmailFailed).not.toHaveBeenCalled();
  });

  it('routes email.failed to orchestrator.onEmailFailed with the reason', async () => {
    const broker = new InMemoryBroker();
    const orchestrator = fakeOrchestrator();
    await new SagaReplyConsumer(
      broker,
      orchestrator as unknown as SubscriptionSagaOrchestrator,
      noopLogger,
    ).start();

    await broker.publish(EMAIL_FAILED, {
      saga_id: SAGA_ID,
      repo: 'owner/repo',
      reason: 'smtp down',
    });

    expect(orchestrator.onEmailFailed).toHaveBeenCalledWith(
      SAGA_ID,
      'smtp down',
    );
    expect(orchestrator.onEmailSent).not.toHaveBeenCalled();
  });

  it('rejects a malformed email.sent payload and propagates the error', async () => {
    const broker = new InMemoryBroker();
    const orchestrator = fakeOrchestrator();
    await new SagaReplyConsumer(
      broker,
      orchestrator as unknown as SubscriptionSagaOrchestrator,
      noopLogger,
    ).start();

    // saga_id is missing
    await expect(
      broker.publish(EMAIL_SENT, { repo: 'owner/repo' }),
    ).rejects.toThrow();

    expect(orchestrator.onEmailSent).not.toHaveBeenCalled();
  });

  it('subscribes only once across repeated start() calls', async () => {
    const broker = new InMemoryBroker();
    const orchestrator = fakeOrchestrator();
    const consumer = new SagaReplyConsumer(
      broker,
      orchestrator as unknown as SubscriptionSagaOrchestrator,
      noopLogger,
    );

    await consumer.start();
    await consumer.start();

    await broker.publish(EMAIL_SENT, { saga_id: SAGA_ID, repo: 'owner/repo' });

    expect(orchestrator.onEmailSent).toHaveBeenCalledTimes(1);
  });
});
