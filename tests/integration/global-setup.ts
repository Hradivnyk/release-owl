import knexLib from 'knex';
import type { Knex } from 'knex';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { config } from 'dotenv';

const RETRY_ATTEMPTS = 10;
const RETRY_DELAY_MS = 1_000;

const sleep = async (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export default async function globalSetup(): Promise<void> {
  // Must run before any src/ imports so DATABASE_URL is available.
  // Fails fast if .env.test is missing — copy .env.test.example to create it.
  const envLoaded = config({
    path: resolve(process.cwd(), '.env.test'),
    override: true,
  });
  if (envLoaded.error) {
    throw new Error(
      'Missing .env.test — copy .env.test.example to get started:\n' +
        '  cp .env.test.example .env.test',
    );
  }
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'Missing DATABASE_URL in .env.test — set DATABASE_URL to your test database',
    );
  }

  const migrationsDir = join(
    process.cwd(),
    'src',
    'platform',
    'db',
    'migrations',
  );

  // A fresh knex instance is created on every attempt.
  //
  // Why: knex eagerly opens `pool.min` connections on instantiation (default
  // min=2). If the DB isn't ready yet those connections fail and the pool
  // enters a broken state — subsequent migrate.latest() calls on the *same*
  // instance will never recover, even after Docker becomes healthy.
  //
  // Recreating the instance gives each retry a clean pool.
  // pool.min=0 prevents the eager pre-connect so the first real I/O happens
  // inside migrate.latest(), where we can catch and retry it.
  // acquireTimeoutMillis caps how long each attempt waits before throwing.
  const createKnex = (): Knex =>
    knexLib({
      client: 'pg',
      connection: process.env.DATABASE_URL,
      pool: { min: 0, max: 1, acquireTimeoutMillis: 5_000 },
      migrations: {
        // Mirror the migrationSource from src/db/knex.ts:
        // normalise .ts → .js so knex_migrations records the same names
        // regardless of whether migrations ran in dev (ts) or prod (js).
        migrationSource: {
          async getMigrations() {
            const files = await readdir(migrationsDir);
            return files
              .filter((f) => f.endsWith('.ts'))
              .sort((a, b) => a.localeCompare(b));
          },
          getMigrationName(file: string) {
            return file.replace(/\.ts$/, '.js');
          },
          async getMigration(file: string): Promise<Knex.Migration> {
            // Jest globalSetup: native import() won't load .ts; ts-jest hooks require.
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
            const mod = require(join(migrationsDir, file)) as Knex.Migration;
            return await Promise.resolve(mod);
          },
        },
      },
    });

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    const knex = createKnex();
    try {
      console.log(
        `\nRunning DB migrations (attempt ${attempt}/${RETRY_ATTEMPTS})...`,
      );
      // eslint-disable-next-line no-await-in-loop
      await knex.migrate.latest();
      console.log('Migrations complete.\n');
      return;
    } catch (err) {
      if (attempt >= RETRY_ATTEMPTS) {
        throw err;
      }
      console.warn(
        `  Failed: ${(err as Error).message}. Retrying in ${RETRY_DELAY_MS / 1_000}s...`,
      );
      // eslint-disable-next-line no-await-in-loop
      await sleep(RETRY_DELAY_MS);
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await knex.destroy().catch(() => {});
    }
  }
}
