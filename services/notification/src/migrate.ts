import 'dotenv/config';
import knex from './db/knex.js';

await knex.migrate.latest();
await knex.destroy();
