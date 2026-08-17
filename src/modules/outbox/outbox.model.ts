import type { Knex } from 'knex';

export interface OutboxRecord {
  id: string;
  routing_key: string;
  payload: unknown;
}

export interface IOutboxModel {
  /**
   * Enqueues an event for later publication. Pass the same transaction as the
   * business write that produced the event so the two commit atomically — that
   * is what makes "record exists" and "event will be published" inseparable.
   */
  enqueue(routingKey: string, payload: unknown, trx?: Knex): Promise<void>;

  /**
   * Atomically claims up to `limit` unpublished rows (oldest first), skipping
   * rows another relay instance has already locked, and bumps their attempt
   * counter. Must run inside the relay's transaction so the lock is held until
   * the rows are marked published.
   */
  claimUnpublished(trx: Knex, limit: number): Promise<OutboxRecord[]>;

  /** Marks rows as published. Must run inside the claiming transaction. */
  markPublished(trx: Knex, ids: string[]): Promise<void>;
}

export class OutboxModel implements IOutboxModel {
  constructor(private readonly db: Knex) {}

  async enqueue(
    routingKey: string,
    payload: unknown,
    trx?: Knex,
  ): Promise<void> {
    await (trx ?? this.db)('outbox').insert({
      routing_key: routingKey,
      payload: JSON.stringify(payload),
    });
  }

  async claimUnpublished(trx: Knex, limit: number): Promise<OutboxRecord[]> {
    const rows = await trx('outbox')
      .update({ attempts: trx.raw('attempts + 1') })
      .whereIn('id', (qb) => {
        qb.select('id')
          .from('outbox')
          .whereNull('published_at')
          .orderBy('created_at')
          .limit(limit)
          .forUpdate()
          .skipLocked();
      })
      .returning(['id', 'routing_key', 'payload']);
    return rows as OutboxRecord[];
  }

  async markPublished(trx: Knex, ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await trx('outbox')
      .whereIn('id', ids)
      .update({ published_at: trx.fn.now() });
  }
}
