import { InMemoryBroker } from '@release-owl/platform';
import { EMAIL_REQUESTED } from '@release-owl/contracts';
import type { ILogger } from '@release-owl/platform';
import { EmailRequestedConsumer } from '../email-requested.consumer.js';
import type { Notifier } from '../email.service.js';

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function fakeNotifier(): Notifier {
  return {
    sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
  };
}

describe('EmailRequestedConsumer', () => {
  it('sends a confirmation email on a confirmation event', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    await new EmailRequestedConsumer(broker, notifier, noopLogger).start();

    await broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: 'evt-1',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
    });

    expect(notifier.sendConfirmationEmail).toHaveBeenCalledWith(
      'a@b.com',
      'tok',
      'owner/repo',
    );
    expect(notifier.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('sends a release notification on a notification event', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    await new EmailRequestedConsumer(broker, notifier, noopLogger).start();

    await broker.publish(EMAIL_REQUESTED, {
      type: 'notification',
      event_id: 'evt-2',
      email: 'a@b.com',
      repo: 'owner/repo',
      tag_name: 'v1',
      unsubscribe_token: 'tok',
    });

    expect(notifier.sendNotificationEmail).toHaveBeenCalledWith(
      'a@b.com',
      'owner/repo',
      'v1',
      'tok',
    );
  });

  it('rejects a payload with a missing required field and sends nothing', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    await new EmailRequestedConsumer(broker, notifier, noopLogger).start();

    // confirmation event without confirm_token
    await expect(
      broker.publish(EMAIL_REQUESTED, {
        type: 'confirmation',
        email: 'a@b.com',
        repo: 'owner/repo',
      }),
    ).rejects.toThrow();

    expect(notifier.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(notifier.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('rejects an event with an unknown type', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    await new EmailRequestedConsumer(broker, notifier, noopLogger).start();

    await expect(
      broker.publish(EMAIL_REQUESTED, {
        type: 'password-reset',
        email: 'a@b.com',
        repo: 'owner/repo',
      }),
    ).rejects.toThrow();

    expect(notifier.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(notifier.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('rejects a payload with a malformed email address', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    await new EmailRequestedConsumer(broker, notifier, noopLogger).start();

    await expect(
      broker.publish(EMAIL_REQUESTED, {
        type: 'confirmation',
        email: 'not-an-email',
        repo: 'owner/repo',
        confirm_token: 'tok',
      }),
    ).rejects.toThrow();

    expect(notifier.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('subscribes only once across repeated start() calls', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    const consumer = new EmailRequestedConsumer(broker, notifier, noopLogger);

    await consumer.start();
    await consumer.start();

    await broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: 'evt-3',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
    });

    expect(notifier.sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('skips a duplicate event without sending a second email', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    await new EmailRequestedConsumer(broker, notifier, noopLogger).start();

    const payload = {
      type: 'confirmation' as const,
      event_id: 'evt-dup',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
    };

    await broker.publish(EMAIL_REQUESTED, payload);
    await broker.publish(EMAIL_REQUESTED, payload);

    expect(notifier.sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('propagates a notifier failure so the broker can nack the message', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    (notifier.sendNotificationEmail as jest.Mock).mockRejectedValue(
      new Error('smtp down'),
    );
    await new EmailRequestedConsumer(broker, notifier, noopLogger).start();

    await expect(
      broker.publish(EMAIL_REQUESTED, {
        type: 'notification',
        event_id: 'evt-4',
        email: 'a@b.com',
        repo: 'owner/repo',
        tag_name: 'v1',
        unsubscribe_token: 'tok',
      }),
    ).rejects.toThrow('smtp down');
  });
});
