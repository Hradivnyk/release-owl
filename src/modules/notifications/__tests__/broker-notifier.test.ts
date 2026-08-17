import { InMemoryBroker } from '@release-owl/platform';
import { EMAIL_REQUESTED } from '@release-owl/contracts';
import { BrokerNotifier } from '../broker-notifier.js';

async function capture(): Promise<{
  broker: InMemoryBroker;
  received: unknown[];
}> {
  const broker = new InMemoryBroker();
  const received: unknown[] = [];
  await broker.subscribe(
    EMAIL_REQUESTED,
    EMAIL_REQUESTED,
    // eslint-disable-next-line @typescript-eslint/require-await -- broker handler signature is async
    async (p) => {
      received.push(p);
    },
  );
  return { broker, received };
}

describe('BrokerNotifier', () => {
  it('publishes a confirmation email.requested event', async () => {
    const { broker, received } = await capture();
    const notifier = new BrokerNotifier(broker);

    await notifier.sendConfirmationEmail('a@b.com', 'tok', 'owner/repo');

    expect(received).toEqual([
      {
        type: 'confirmation',
        event_id: expect.any(String),
        email: 'a@b.com',
        repo: 'owner/repo',
        confirm_token: 'tok',
      },
    ]);
  });

  it('publishes a notification email.requested event', async () => {
    const { broker, received } = await capture();
    const notifier = new BrokerNotifier(broker);

    await notifier.sendNotificationEmail('a@b.com', 'owner/repo', 'v1', 'tok');

    expect(received).toEqual([
      {
        type: 'notification',
        event_id: expect.any(String),
        email: 'a@b.com',
        repo: 'owner/repo',
        tag_name: 'v1',
        unsubscribe_token: 'tok',
      },
    ]);
  });
});
