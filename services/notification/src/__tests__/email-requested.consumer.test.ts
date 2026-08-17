import type { Knex } from 'knex';
import { InMemoryBroker } from '@release-owl/platform';
import {
  EMAIL_REQUESTED,
  EMAIL_SENT,
  EMAIL_FAILED,
} from '@release-owl/contracts';
import type { ILogger } from '../logger.js';
import { EmailRequestedConsumer } from '../email-requested.consumer.js';
import type { Notifier } from '../email.service.js';
import type { IOutboxModel } from '../outbox/outbox.model.js';
import type { IInboxModel } from '../inbox/inbox.model.js';
import type { IUnitOfWork } from '../db/unit-of-work.js';

const SAGA_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const fakeTrx = {} as Knex.Transaction;

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function fakeNotifier(): jest.Mocked<Notifier> {
  return {
    sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeInbox(
  alreadyProcessed = false,
  status: 'sent' | 'failed' | null = null,
): jest.Mocked<IInboxModel> {
  return {
    wasProcessed: jest.fn().mockResolvedValue(alreadyProcessed),
    getStatus: jest.fn().mockResolvedValue(status),
    markProcessed: jest.fn().mockResolvedValue(undefined),
  };
}

function fakeOutbox(): jest.Mocked<IOutboxModel> {
  return {
    enqueue: jest.fn().mockResolvedValue(undefined),
    claimUnpublished: jest.fn(),
    markPublished: jest.fn(),
  };
}

function fakeUow(): jest.Mocked<IUnitOfWork> & { run: jest.Mock } {
  return {
    run: jest.fn(async (work: (trx: Knex.Transaction) => Promise<unknown>) =>
      work(fakeTrx),
    ) as jest.Mock,
  };
}

function buildConsumer(
  broker: InMemoryBroker,
  notifier: jest.Mocked<Notifier>,
  inbox: jest.Mocked<IInboxModel>,
  outbox: jest.Mocked<IOutboxModel>,
  uow: ReturnType<typeof fakeUow>,
) {
  return new EmailRequestedConsumer(
    broker,
    notifier,
    noopLogger,
    inbox,
    outbox,
    uow,
  );
}

// ── Confirmation emails (Saga participant) ──────────────────────────────────

describe('EmailRequestedConsumer — confirmation (saga)', () => {
  it('sends the email and enqueues email.sent reply via outbox on success', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    const inbox = fakeInbox();
    const outbox = fakeOutbox();
    const uow = fakeUow();

    await buildConsumer(broker, notifier, inbox, outbox, uow).start();
    await broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: 'evt-1',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
      saga_id: SAGA_ID,
    });

    expect(notifier.sendConfirmationEmail).toHaveBeenCalledWith(
      'a@b.com',
      'tok',
      'owner/repo',
    );
    expect(inbox.markProcessed).toHaveBeenCalledWith(SAGA_ID, 'sent', fakeTrx);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      EMAIL_SENT,
      { saga_id: SAGA_ID, repo: 'owner/repo' },
      fakeTrx,
    );
  });

  it('enqueues email.failed reply and marks inbox failed when send exhausts retries', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    notifier.sendConfirmationEmail.mockRejectedValue(new Error('smtp down'));
    const inbox = fakeInbox();
    const outbox = fakeOutbox();
    const uow = fakeUow();

    await buildConsumer(broker, notifier, inbox, outbox, uow).start();
    // Should NOT throw: failure is handled by enqueuing email.failed
    await broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: 'evt-2',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
      saga_id: SAGA_ID,
    });

    expect(inbox.markProcessed).toHaveBeenCalledWith(
      SAGA_ID,
      'failed',
      fakeTrx,
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(
      EMAIL_FAILED,
      expect.objectContaining({ saga_id: SAGA_ID, repo: 'owner/repo' }),
      fakeTrx,
    );
    // Does not rethrow — broker will ack
    expect(notifier.sendNotificationEmail).not.toHaveBeenCalled();
  });

  it('re-enqueues email.sent reply without resending on duplicate when first send succeeded', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    const inbox = fakeInbox(true, 'sent'); // already processed as sent
    const outbox = fakeOutbox();
    const uow = fakeUow();

    await buildConsumer(broker, notifier, inbox, outbox, uow).start();
    await broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: 'evt-3',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
      saga_id: SAGA_ID,
    });

    expect(notifier.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      EMAIL_SENT,
      { saga_id: SAGA_ID, repo: 'owner/repo' },
      fakeTrx,
    );
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });

  it('re-enqueues email.failed reply without resending on duplicate when first send failed', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    const inbox = fakeInbox(true, 'failed'); // already processed as failed
    const outbox = fakeOutbox();
    const uow = fakeUow();

    await buildConsumer(broker, notifier, inbox, outbox, uow).start();
    await broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: 'evt-4',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
      saga_id: SAGA_ID,
    });

    expect(notifier.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith(
      EMAIL_FAILED,
      expect.objectContaining({ saga_id: SAGA_ID, repo: 'owner/repo' }),
      fakeTrx,
    );
    expect(inbox.markProcessed).not.toHaveBeenCalled();
  });

  it('inbox markProcessed and outbox enqueue run inside the same UoW transaction on success', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    const inbox = fakeInbox();
    const outbox = fakeOutbox();
    const uow = fakeUow();

    await buildConsumer(broker, notifier, inbox, outbox, uow).start();
    await broker.publish(EMAIL_REQUESTED, {
      type: 'confirmation',
      event_id: 'evt-5',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'tok',
      saga_id: SAGA_ID,
    });

    expect(uow.run).toHaveBeenCalledTimes(1);
    // Both inbox and outbox received the same fake transaction object
    expect(inbox.markProcessed).toHaveBeenCalledWith(SAGA_ID, 'sent', fakeTrx);
    expect(outbox.enqueue).toHaveBeenCalledWith(
      EMAIL_SENT,
      expect.anything(),
      fakeTrx,
    );
  });
});

// ── Release notification emails (fire-and-forget, no saga) ──────────────────

describe('EmailRequestedConsumer — notification (fire-and-forget)', () => {
  it('sends a release notification email', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    const inbox = fakeInbox();
    const outbox = fakeOutbox();
    const uow = fakeUow();

    await buildConsumer(broker, notifier, inbox, outbox, uow).start();
    await broker.publish(EMAIL_REQUESTED, {
      type: 'notification',
      event_id: 'evt-6',
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
    expect(notifier.sendConfirmationEmail).not.toHaveBeenCalled();
    // No inbox/outbox involvement for fire-and-forget
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it('propagates a notifier failure so the broker can nack the message', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    notifier.sendNotificationEmail.mockRejectedValue(new Error('smtp down'));
    const inbox = fakeInbox();
    const outbox = fakeOutbox();
    const uow = fakeUow();

    await buildConsumer(broker, notifier, inbox, outbox, uow).start();

    await expect(
      broker.publish(EMAIL_REQUESTED, {
        type: 'notification',
        event_id: 'evt-7',
        email: 'a@b.com',
        repo: 'owner/repo',
        tag_name: 'v1',
        unsubscribe_token: 'tok',
      }),
    ).rejects.toThrow('smtp down');
  });
});

// ── Schema validation ────────────────────────────────────────────────────────

describe('EmailRequestedConsumer — schema validation', () => {
  it('rejects a confirmation payload without saga_id', async () => {
    const broker = new InMemoryBroker();
    const consumer = buildConsumer(
      broker,
      fakeNotifier(),
      fakeInbox(),
      fakeOutbox(),
      fakeUow(),
    );
    await consumer.start();

    await expect(
      broker.publish(EMAIL_REQUESTED, {
        type: 'confirmation',
        event_id: 'evt-8',
        email: 'a@b.com',
        repo: 'owner/repo',
        confirm_token: 'tok',
        // saga_id deliberately omitted
      }),
    ).rejects.toThrow();
  });

  it('rejects a payload with an unknown type', async () => {
    const broker = new InMemoryBroker();
    const consumer = buildConsumer(
      broker,
      fakeNotifier(),
      fakeInbox(),
      fakeOutbox(),
      fakeUow(),
    );
    await consumer.start();

    await expect(
      broker.publish(EMAIL_REQUESTED, {
        type: 'password-reset',
        email: 'a@b.com',
        repo: 'owner/repo',
      }),
    ).rejects.toThrow();
  });

  it('subscribes only once across repeated start() calls', async () => {
    const broker = new InMemoryBroker();
    const notifier = fakeNotifier();
    const inbox = fakeInbox();
    const outbox = fakeOutbox();
    const uow = fakeUow();
    const consumer = buildConsumer(broker, notifier, inbox, outbox, uow);

    await consumer.start();
    await consumer.start();

    await broker.publish(EMAIL_REQUESTED, {
      type: 'notification',
      event_id: 'evt-9',
      email: 'a@b.com',
      repo: 'owner/repo',
      tag_name: 'v1',
      unsubscribe_token: 'tok',
    });

    expect(notifier.sendNotificationEmail).toHaveBeenCalledTimes(1);
  });
});
