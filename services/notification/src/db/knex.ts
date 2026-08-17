import knexLib from 'knex';
import type { Knex } from 'knex';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { config } from '../config.js';

const isProduction = process.env.NODE_ENV === 'production';

// Use import.meta.url so the migrations directory is resolved relative to
// this file, not relative to process.cwd() — the CWD varies between
// `npm run dev` (package dir) and the Docker container (WORKDIR /app).
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// dev:  services/notification/src/db/migrations   (ts source)
// prod: services/notification/dist/db/migrations  (compiled js)
// In both cases __dirname is the directory of this module, so ../migrations works.
const migrationsDir = join(__dirname, 'migrations');

// Custom migration source that always records filenames with .js extension
// so that dev (tsx, .ts files) and prod (node, .js files) share the same
// knex_migrations table entries without conflicts.
const migrationSource: Knex.MigrationSource<string> = {
  async getMigrations() {
    const ext = isProduction ? '.js' : '.ts';
    // Path is derived from import.meta.url, not user input.

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
