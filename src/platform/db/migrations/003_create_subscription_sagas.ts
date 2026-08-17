import type { Knex } from 'knex';

// Saga state table for the orchestrated subscribe→confirm-email Saga.
// Each row tracks one in-flight (or terminated) saga instance.
//
// `id`              — also serves as the correlation id (saga_id) threaded through
//                     the email.requested command and the email.sent/email.failed reply.
// `subscription_id` — the pending subscription this saga is driving; stored as a plain
//                     uuid (no FK) so the subscription can be deleted during compensation
//                     without first removing the saga audit row.
// `status`          — lifecycle: 'started' → 'completed' (email sent) | 'compensated'
//                     (email permanently failed, subscription deleted).
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('subscription_sagas', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    // No FK constraint: the saga row outlives the subscription row during compensation.
    table.uuid('subscription_id').notNullable();
    table.text('type').notNullable().defaultTo('subscribe');
    table.text('status').notNullable().defaultTo('started');
    table
      .timestamp('created_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());
    table
      .timestamp('updated_at', { useTz: true })
      .notNullable()
      .defaultTo(knex.fn.now());

    // Composite index: sweeper filters by status='started' and age, so include both columns.
    table.index(['status', 'created_at'], 'subscription_sagas_status_idx');
  });
  // Prevent invalid states at the database level.
  await knex.raw(`
    ALTER TABLE subscription_sagas
      ADD CONSTRAINT subscription_sagas_type_chk CHECK (type IN ('subscribe')),
      ADD CONSTRAINT subscription_sagas_status_chk CHECK (status IN ('started', 'completed', 'compensated'))
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('subscription_sagas');
}
