import type { Knex } from 'knex';

export interface IRepositoryModel {
  upsert(repo: string, trx?: Knex): Promise<void>;
  updateLastSeenTag(repo: string, tag: string): Promise<void>;
}

export class RepositoryModel implements IRepositoryModel {
  constructor(private readonly db: Knex) {}

  async upsert(repo: string, trx?: Knex): Promise<void> {
    await (trx ?? this.db)('repositories')
      .insert({ repo })
      .onConflict('repo')
      .ignore();
  }

  async updateLastSeenTag(repo: string, tag: string): Promise<void> {
    await this.db('repositories')
      .where({ repo })
      .update({ last_seen_tag: tag });
  }
}
