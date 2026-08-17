import type { Knex } from 'knex';

// Inbox deduplication table for exactly-once processing of email.requested commands.
// `id` is the saga_id from the inbound command — the PK constraint enforces that
// the same command is only processed once even when redelivered by RabbitMQ.
// Insert-inbox and enqueue-outbox happen in the same UoW transaction so the dedup
// record and the reply event are committed atomically.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('inbox', (table) => {
    // saga_id serves as the natural deduplication key.
    table.text('id').primary();
    // 'sent' = email was delivered; 'failed' = retries exhausted.
    table.text('status').notNullable();
    table
      .timestamp('processed_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('inbox');
}
