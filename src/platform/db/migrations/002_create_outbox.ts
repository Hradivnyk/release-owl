import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('outbox', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('routing_key').notNullable();
    table.jsonb('payload').notNullable();
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table.timestamp('published_at', { useTz: true }).nullable();
    table.integer('attempts').notNullable().defaultTo(0);
  });
  // Partial index: the relay's hot path only touches unpublished rows oldest-first.
  await knex.raw(
    'CREATE INDEX outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('outbox');
}
