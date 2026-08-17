import type { Knex } from 'knex';

const knexConfig: Knex.Config = {
  client: 'pg',
  connection: process.env['DATABASE_URL'],
  migrations: {
    directory: './src/platform/db/migrations',
    extension: 'ts',
    loadExtensions: ['.ts'],
  },
};

export default knexConfig;
