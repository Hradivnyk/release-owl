import type { Knex } from 'knex';
import type { IBroker, ILogger } from '@release-owl/platform';
import { OutboxRelay } from '../outbox.relay.js';
import type { IOutboxModel, OutboxRecord } from '../outbox.model.js';

const ROUTING_KEY = 'email.requested';

function record(id: string): OutboxRecord {
  return {
    id,
    routing_key: ROUTING_KEY,
    payload: { type: 'confirmation', id },
  };
}

describe('OutboxRelay', () => {
  let mockOutbox: jest.Mocked<IOutboxModel>;
  let mockBroker: jest.Mocked<Pick<IBroker, 'publish'>>;
  let mockUow: { run: jest.Mock };
  let logger: ILogger;
  const fakeTrx = {} as Knex.Transaction;

  const buildRelay = (batchSize: number) =>
    new OutboxRelay(
      mockOutbox,
      mockBroker as unknown as IBroker,
      mockUow,
      logger,
      { pollIntervalMs: 1_000, batchSize },
    );

  beforeEach(() => {
    mockOutbox = {
      enqueue: jest.fn(),
      claimUnpublished: jest.fn(),
      markPublished: jest.fn().mockResolvedValue(undefined),
    };
    mockBroker = { publish: jest.fn().mockResolvedValue(undefined) };
    mockUow = {
      run: jest.fn(async (work: (trx: Knex.Transaction) => Promise<unknown>) =>
        work(fakeTrx),
      ),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
  });

  it('publishes each claimed event and marks the batch published', async () => {
    mockOutbox.claimUnpublished.mockResolvedValueOnce([record('1')]);

    await buildRelay(50).drain();

    expect(mockBroker.publish).toHaveBeenCalledWith(ROUTING_KEY, {
      type: 'confirmation',
      id: '1',
    });
    expect(mockOutbox.markPublished).toHaveBeenCalledWith(fakeTrx, ['1']);
  });

  it('publishes nothing and stops when there are no pending events', async () => {
    mockOutbox.claimUnpublished.mockResolvedValueOnce([]);

    await buildRelay(50).drain();

    expect(mockBroker.publish).not.toHaveBeenCalled();
    expect(mockOutbox.claimUnpublished).toHaveBeenCalledTimes(1);
  });

  it('keeps draining while a full batch is returned, then stops on a short one', async () => {
    mockOutbox.claimUnpublished
      .mockResolvedValueOnce([record('1'), record('2')]) // full batch -> continue
      .mockResolvedValueOnce([record('3')]); // short batch -> stop

    await buildRelay(2).drain();

    expect(mockOutbox.claimUnpublished).toHaveBeenCalledTimes(2);
    expect(mockBroker.publish).toHaveBeenCalledTimes(3);
  });

  it('does not mark a batch published when a publish fails (rolled back, retried later)', async () => {
    mockOutbox.claimUnpublished.mockResolvedValueOnce([record('1')]);
    mockBroker.publish.mockRejectedValueOnce(new Error('broker down'));

    await expect(buildRelay(50).drain()).rejects.toThrow('broker down');
    expect(mockOutbox.markPublished).not.toHaveBeenCalled();
  });
});
