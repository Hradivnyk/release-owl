import type { Knex } from 'knex';

/**
 * Runs a unit of work inside a single database transaction. Lets a service
 * compose several repository writes atomically without depending on the
 * concrete Knex instance or knowing how transactions are managed.
 */
export interface IUnitOfWork {
  run<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T>;
}

export class KnexUnitOfWork implements IUnitOfWork {
  constructor(private readonly db: Knex) {}

  async run<T>(work: (trx: Knex.Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
}
