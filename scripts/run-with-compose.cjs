'use strict';

/**
 * Cross-platform test runner with Docker Compose lifecycle management.
 *
 * Usage:
 *   node scripts/run-with-compose.cjs <compose-files> -- <test-command>
 *
 * Example:
 *   node scripts/run-with-compose.cjs \
 *     -f docker-compose.test.yml \
 *     -- jest --selectProjects integration --runInBand
 *
 * Guarantees:
 *   - `docker compose up` failure aborts immediately with a non-zero exit code.
 *   - `docker compose down` always runs, even when the test command fails.
 *   - Exits with the test command's exit code, not the cleanup's.
 */

const { execSync } = require('child_process');
const path = require('path');

// Prepend node_modules/.bin to PATH so local devDependency binaries (e.g.
// `jest`, `playwright`) are resolved before any globally installed packages.
// execSync spawns a new shell that does not inherit the PATH augmentation npm
// adds when running package.json scripts, so without this the shell would pick
// up a wrong global binary or fail with "command not found".
const localBin = path.join(__dirname, '..', 'node_modules', '.bin');
process.env.PATH = `${localBin}${path.delimiter}${process.env.PATH}`;

// Split argv on '--': everything before is compose flags, everything after is
// the test command.
const args = process.argv.slice(2);
const separatorIndex = args.indexOf('--');

if (separatorIndex === -1) {
  console.error(
    'Usage: node run-with-compose.cjs <compose-flags> [--env KEY=VALUE ...] -- <test-command>',
  );
  process.exit(1);
}

// Parse --env KEY=VALUE flags from the compose section and apply them to the
// current process so the test command inherits them (cross-platform, no deps).
const rawComposeArgs = args.slice(0, separatorIndex);
const composeFlagParts = [];
for (let i = 0; i < rawComposeArgs.length; i++) {
  if (rawComposeArgs[i] === '--env' && i + 1 < rawComposeArgs.length) {
    const [key, ...rest] = rawComposeArgs[++i].split('=');
    process.env[key] = rest.join('=');
  } else {
    composeFlagParts.push(rawComposeArgs[i]);
  }
}

const composeFlags = composeFlagParts.join(' ');
const testCommand = args.slice(separatorIndex + 1).join(' ');

if (!testCommand.trim()) {
  console.error('Error: no test command provided after --');
  process.exit(1);
}

const compose = `docker compose ${composeFlags}`;

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

// 1. Pre-clean: remove any stale containers and volumes from a previous run so
//    that services (e.g. PostgreSQL) always initialise from scratch.
try {
  run(`${compose} down -v`);
} catch {
  // Non-fatal — nothing to clean up on a fresh machine.
}

// 2. Bring the stack up — fail fast (with cleanup) if this step errors,
//    e.g. when --wait times out waiting for a health-check.
//    --build rebuilds images from the current source on every run; without it
//    Compose silently reuses a stale image left over from another branch, which
//    can start an app that never becomes healthy (e.g. one that blocks on a
//    broker absent from this stack). Layer caching keeps no-op rebuilds fast.
try {
  run(`${compose} up -d --build --wait`);
} catch (err) {
  try {
    run(`${compose} down -v`);
  } catch {
    // best-effort cleanup
  }
  process.exit(typeof err.status === 'number' ? err.status : 1);
}

// 3. Run tests — capture the exit code without throwing.
let testExitCode = 0;
try {
  run(testCommand);
} catch (err) {
  testExitCode = typeof err.status === 'number' ? err.status : 1;
}

// 4. Always tear the stack down with -v so volumes are removed too,
//    ensuring a clean slate for the next run.
try {
  run(`${compose} down -v`);
} catch {
  // Cleanup errors are non-fatal; the test result is what matters.
}

process.exit(testExitCode);
