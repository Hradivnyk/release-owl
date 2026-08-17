import type { IBroker } from './broker.interface.js';

type SubscriptionRecord = {
  queue: string;
  bindingKey: string;
  handler: (payload: unknown) => Promise<void>;
};

function matchesTopic(routingKey: string, bindingKey: string): boolean {
  const rk = routingKey.split('.');
  const bk = bindingKey.split('.');

  function match(ri: number, bi: number): boolean {
    if (bi === bk.length) return ri === rk.length;
    if (bk[bi] === '#') {
      for (let skip = ri; skip <= rk.length; skip++) {
        if (match(skip, bi + 1)) return true;
      }
      return false;
    }
    if (ri === rk.length) return false;
    if (bk[bi] === '*' || bk[bi] === rk[ri]) return match(ri + 1, bi + 1);
    return false;
  }

  return match(0, 0);
}

export class InMemoryBroker implements IBroker {
  private readonly subscriptions: SubscriptionRecord[] = [];

  async connect(): Promise<void> {}
  async close(): Promise<void> {}

  async publish<T>(routingKey: string, payload: T): Promise<void> {
    const matching = this.subscriptions.filter((s) =>
      matchesTopic(routingKey, s.bindingKey),
    );

    // Group by queue: within a queue only one handler runs (competing consumers)
    const byQueue = new Map<string, SubscriptionRecord>();
    for (const sub of matching) {
      if (!byQueue.has(sub.queue)) {
        byQueue.set(sub.queue, sub);
      }
    }

    await Promise.all(
      Array.from(byQueue.values()).map(async (sub) => sub.handler(payload)),
    );
  }

  async subscribe<T>(
    queue: string,
    routingKey: string,
    handler: (payload: T) => Promise<void>,
  ): Promise<void> {
    await Promise.resolve();
    this.subscriptions.push({
      queue,
      bindingKey: routingKey,
      handler: handler as (payload: unknown) => Promise<void>,
    });
  }
}
