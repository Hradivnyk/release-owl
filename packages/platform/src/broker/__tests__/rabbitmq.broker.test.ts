import amqplib from 'amqplib';
import { RabbitMQBroker } from '../rabbitmq.broker.js';
import type { ILogger } from '../../logger/logger.interface.js';

jest.mock('amqplib', () => ({
  __esModule: true,
  default: { connect: jest.fn() },
}));

const EXCHANGE = 'release-owl.events';
const DEAD_LETTER_EXCHANGE = 'release-owl.events.dlx';

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

type Msg = { content: Buffer } | null;
type ConsumeCb = (msg: Msg) => void | Promise<void>;

function makeChannel() {
  let consumeCb: ConsumeCb | undefined;
  const channel = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn((_queue: string, cb: ConsumeCb) => {
      consumeCb = cb;
      return { consumerTag: 'tag' };
    }),
    publish: jest.fn(
      (
        _exchange: string,
        _routingKey: string,
        _content: Buffer,
        _options: unknown,
        cb: (err: Error | null) => void,
      ) => cb(null),
    ),
    ack: jest.fn(),
    nack: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
  // Delivers a message through whatever handler the broker registered.
  const deliver = (msg: Msg): void | Promise<void> => consumeCb?.(msg);
  return { channel, deliver };
}

function makeConnection(channel: ReturnType<typeof makeChannel>['channel']) {
  return {
    createConfirmChannel: jest.fn().mockResolvedValue(channel),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

const mockConnect = amqplib.connect as unknown as jest.Mock;

function bodyOf(payload: unknown): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

describe('RabbitMQBroker delivery cycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('acks the message after the handler succeeds', async () => {
    const { channel, deliver } = makeChannel();
    mockConnect.mockResolvedValue(makeConnection(channel));

    const broker = new RabbitMQBroker('amqp://localhost', noopLogger);
    await broker.connect();

    const handler = jest.fn().mockResolvedValue(undefined);
    await broker.subscribe('queue', 'rk', handler);

    await deliver({ content: bodyOf({ hello: 'world' }) });

    expect(handler).toHaveBeenCalledWith({ hello: 'world' });
    expect(channel.ack).toHaveBeenCalledTimes(1);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('wires the queue to a dead-letter exchange and binds a per-queue DLQ', async () => {
    const { channel } = makeChannel();
    mockConnect.mockResolvedValue(makeConnection(channel));

    const broker = new RabbitMQBroker('amqp://localhost', noopLogger);
    await broker.connect();

    const handler = jest.fn().mockResolvedValue(undefined);
    await broker.subscribe('queue', 'rk', handler);

    expect(channel.assertExchange).toHaveBeenCalledWith(
      DEAD_LETTER_EXCHANGE,
      'topic',
      { durable: true },
    );
    expect(channel.assertQueue).toHaveBeenCalledWith('queue.dlq', {
      durable: true,
    });
    expect(channel.bindQueue).toHaveBeenCalledWith(
      'queue.dlq',
      DEAD_LETTER_EXCHANGE,
      'rk',
    );
    expect(channel.assertQueue).toHaveBeenCalledWith('queue', {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': 'rk',
      },
    });
  });

  it('nacks without requeue when the handler throws', async () => {
    const { channel, deliver } = makeChannel();
    mockConnect.mockResolvedValue(makeConnection(channel));

    const broker = new RabbitMQBroker('amqp://localhost', noopLogger);
    await broker.connect();

    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    await broker.subscribe('queue', 'rk', handler);

    await deliver({ content: bodyOf({ hello: 'world' }) });

    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('nacks when the message body is not valid JSON', async () => {
    const { channel, deliver } = makeChannel();
    mockConnect.mockResolvedValue(makeConnection(channel));

    const broker = new RabbitMQBroker('amqp://localhost', noopLogger);
    await broker.connect();

    const handler = jest.fn().mockResolvedValue(undefined);
    await broker.subscribe('queue', 'rk', handler);

    await deliver({ content: Buffer.from('not-json') });

    expect(handler).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(expect.anything(), false, false);
    expect(channel.ack).not.toHaveBeenCalled();
  });

  it('ignores a null message (consumer cancelled by the broker)', async () => {
    const { channel, deliver } = makeChannel();
    mockConnect.mockResolvedValue(makeConnection(channel));

    const broker = new RabbitMQBroker('amqp://localhost', noopLogger);
    await broker.connect();

    const handler = jest.fn().mockResolvedValue(undefined);
    await broker.subscribe('queue', 'rk', handler);

    await deliver(null);

    expect(handler).not.toHaveBeenCalled();
    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('publishes a persistent JSON message to the topic exchange', async () => {
    const { channel } = makeChannel();
    mockConnect.mockResolvedValue(makeConnection(channel));

    const broker = new RabbitMQBroker('amqp://localhost', noopLogger);
    await broker.connect();

    await broker.publish('rk', { a: 1 });

    expect(channel.publish).toHaveBeenCalledWith(
      EXCHANGE,
      'rk',
      expect.any(Buffer),
      { persistent: true },
      expect.any(Function),
    );
    const sentBody = channel.publish.mock.calls[0][2];
    expect(JSON.parse(sentBody.toString())).toEqual({ a: 1 });
  });
});
