import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('repositories', (table) => {
    table.text('repo').primary();
    table.text('last_seen_tag').nullable();
  });

  await knex.schema.createTable('subscriptions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.text('email').notNullable();
    table
      .text('repo')
      .notNullable()
      .references('repo')
      .inTable('repositories')
      .onDelete('CASCADE');
    table.text('confirm_token').notNullable().unique();
    table.text('unsubscribe_token').notNullable().unique();
    table.text('status').notNullable().defaultTo('pending');

    table.unique(['email', 'repo']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('subscriptions');
  await knex.schema.dropTableIfExists('repositories');
}
