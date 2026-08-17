import knexLib from 'knex';
import type { Knex } from 'knex';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config/index.js';

const isProduction = process.env.NODE_ENV === 'production';

const migrationsDir = join(
  process.cwd(),
  isProduction ? 'dist' : 'src',
  'platform',
  'db',
  'migrations',
);

// Custom migration source that always records filenames with .js extension
// so that dev (tsx, .ts files) and prod (node, .js files) share the same
// knex_migrations table entries without conflicts.
const migrationSource: Knex.MigrationSource<string> = {
  async getMigrations() {
    const ext = isProduction ? '.js' : '.ts';
    // Path is process.cwd() + fixed segments (src|dist/db/migrations), not user input.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- see above
    const files = await readdir(migrationsDir);
    return files
      .filter((f) => f.endsWith(ext))
      .sort((a, b) => a.localeCompare(b));
  },
  getMigrationName(file) {
    // Normalize .ts → .js so both environments write the same name to the DB
    return file.endsWith('.ts') ? `${file.slice(0, -3)}.js` : file;
  },
  async getMigration(file) {
    // pathToFileURL ensures valid file:// URL on Windows (D:\... → file:///D:/...)
    return import(
      pathToFileURL(join(migrationsDir, file)).href
    ) as Promise<Knex.Migration>;
  },
};

const knexConfig: Knex.Config = {
  client: 'pg',
  connection: config.db.url,
  migrations: { migrationSource },
};

const knex = knexLib(knexConfig);

export default knex;
