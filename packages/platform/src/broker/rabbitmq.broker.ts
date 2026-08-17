import { EventEmitter } from 'node:events';
import amqplib from 'amqplib';
import type { IBroker } from './broker.interface.js';
import type { ILogger } from '../logger/logger.interface.js';

const EXCHANGE = 'release-owl.events';
const DEAD_LETTER_EXCHANGE = 'release-owl.events.dlx';
const MAX_RETRIES = 10;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

type SubscriptionRecord = {
  queue: string;
  routingKey: string;
  handler: (payload: unknown) => Promise<void>;
};

async function sleepWithJitter(delay: number): Promise<void> {
  const jittered = delay / 2 + Math.random() * (delay / 2);
  return new Promise((resolve) => setTimeout(resolve, jittered));
}

export class RabbitMQBroker extends EventEmitter implements IBroker {
  private connection: amqplib.ChannelModel | null = null;
  private channel: amqplib.ConfirmChannel | null = null;
  private subscriptions: SubscriptionRecord[] = [];
  private isClosing = false;
  private isReconnecting = false;
  private reconnectPromise: Promise<void> | null = null;

  constructor(
    private readonly url: string,
    private readonly logger: ILogger,
  ) {
    super();
  }

  async connect(): Promise<void> {
    let attempt = 0;
    let delay = INITIAL_BACKOFF_MS;

    for (;;) {
      attempt++;
      try {
        // eslint-disable-next-line no-await-in-loop -- connection attempts are inherently sequential
        await this.setupConnection();
        return;
      } catch (err) {
        if (attempt >= MAX_RETRIES) {
          this.logger.error(
            { event: 'broker.connect_exhausted', attempt, err },
            'RabbitMQ initial connection retries exhausted',
          );
          throw err;
        }
        this.logger.warn(
          {
            event: 'broker.connect_retry',
            attempt,
            maxRetries: MAX_RETRIES,
            err,
          },
          `RabbitMQ not ready, retrying ${attempt.toString()}/${MAX_RETRIES.toString()}`,
        );
        // eslint-disable-next-line no-await-in-loop -- backoff sleep between retries
        await sleepWithJitter(delay);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
    }
  }

  private async setupConnection(): Promise<void> {
    this.connection = await amqplib.connect(this.url);
    this.channel = await this.connection.createConfirmChannel();
    await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    await this.channel.assertExchange(DEAD_LETTER_EXCHANGE, 'topic', {
      durable: true,
    });

    this.connection.on('close', () => {
      if (!this.isClosing && !this.isReconnecting) {
        this.connection = null;
        this.channel = null;
        this.logger.warn(
          { event: 'broker.connection_lost' },
          'RabbitMQ connection closed, reconnecting',
        );
        this.reconnectPromise = this.reconnectWithBackoff();
      }
    });

    this.connection.on('error', (err: Error) => {
      this.logger.error(
        { event: 'broker.connection_error', err },
        'RabbitMQ connection error',
      );
    });

    if (this.isClosing) return;

    for (const sub of this.subscriptions) {
      // eslint-disable-next-line no-await-in-loop -- subscriptions must be re-established sequentially
      await this.doSubscribe(sub);
    }

    this.logger.info(
      { event: 'broker.connected', exchange: EXCHANGE },
      'RabbitMQ connected',
    );
  }

  private async reconnectWithBackoff(): Promise<void> {
    this.isReconnecting = true;
    let attempt = 0;
    let delay = INITIAL_BACKOFF_MS;

    try {
      while (attempt < MAX_RETRIES) {
        if (this.isClosing) return;
        attempt++;
        this.logger.info(
          {
            event: 'broker.reconnect_attempt',
            attempt,
            maxRetries: MAX_RETRIES,
          },
          `Reconnect attempt ${attempt.toString()}/${MAX_RETRIES.toString()}`,
        );
        try {
          // eslint-disable-next-line no-await-in-loop -- retries are inherently sequential
          await this.setupConnection();
          if (this.isClosing) {
            // eslint-disable-next-line no-await-in-loop -- shutdown teardown, not a retry
            await this.channel?.close();
            // eslint-disable-next-line no-await-in-loop -- shutdown teardown, not a retry
            await this.connection?.close();
            return;
          }
          this.logger.info(
            { event: 'broker.reconnected' },
            'RabbitMQ reconnected',
          );
          return;
        } catch (err) {
          this.logger.error(
            { event: 'broker.reconnect_failed', attempt, err },
            'Reconnect attempt failed',
          );
          if (this.isClosing) return;
          // eslint-disable-next-line no-await-in-loop -- backoff sleep between retries
          await sleepWithJitter(delay);
          delay = Math.min(delay * 2, MAX_BACKOFF_MS);
        }
      }

      this.logger.error(
        { event: 'broker.reconnect_exhausted', maxRetries: MAX_RETRIES },
        'RabbitMQ reconnect retries exhausted',
      );
      this.emit('fatal', new Error('RabbitMQ reconnect retries exhausted'));
    } finally {
      this.isReconnecting = false;
    }
  }

  async publish<T>(routingKey: string, payload: T): Promise<void> {
    if (!this.channel) throw new Error('Broker not connected');
    const content = Buffer.from(JSON.stringify(payload));
    const ch = this.channel;
    return new Promise<void>((resolve, reject) => {
      ch.publish(EXCHANGE, routingKey, content, { persistent: true }, (err) => {
        if (err) reject(err instanceof Error ? err : new Error(String(err)));
        else resolve();
      });
    });
  }

  async subscribe<T>(
    queue: string,
    routingKey: string,
    handler: (payload: T) => Promise<void>,
  ): Promise<void> {
    const record: SubscriptionRecord = {
      queue,
      routingKey,
      handler: handler as (payload: unknown) => Promise<void>,
    };
    this.subscriptions.push(record);
    await this.doSubscribe(record);
  }

  private async doSubscribe(record: SubscriptionRecord): Promise<void> {
    if (!this.channel) throw new Error('Broker not connected');

    const deadLetterQueue = `${record.queue}.dlq`;
    await this.channel.assertQueue(deadLetterQueue, { durable: true });
    await this.channel.bindQueue(
      deadLetterQueue,
      DEAD_LETTER_EXCHANGE,
      record.routingKey,
    );

    await this.channel.assertQueue(record.queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': DEAD_LETTER_EXCHANGE,
        'x-dead-letter-routing-key': record.routingKey,
      },
    });
    await this.channel.bindQueue(record.queue, EXCHANGE, record.routingKey);
    const ch = this.channel;
    // The amqplib consume callback is typed as returning void, but async handling is intentional.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    await ch.consume(record.queue, async (msg): Promise<void> => {
      if (!msg) return;
      try {
        const payload = JSON.parse(msg.content.toString()) as unknown;
        await record.handler(payload);
        ch.ack(msg);
      } catch (err) {
        this.logger.error(
          { event: 'broker.consume_error', err, routingKey: record.routingKey },
          'Message handler failed',
        );
        ch.nack(msg, false, false);
      }
    });
  }

  async close(): Promise<void> {
    this.isClosing = true;
    if (this.reconnectPromise) {
      await this.reconnectPromise;
    }
    await this.channel?.close();
    await this.connection?.close();
  }
}
