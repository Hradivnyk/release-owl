# Architectural Tests (Fitness Functions)

Release Owl's `app` service is a modular monolith whose architecture is not just
drawn in [architecture.md](architecture.md) — it is **enforced in code**. Forbidden
dependencies fail the build instead of silently eroding the design.

Layers are identified by **filename convention** (no folder reshuffle): a file's
name tells you its layer, and `index.ts` barrels define each module's public surface.

## Layer model

| Layer                     | Pattern                                                                                                  | May depend on                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Presentation              | `*.controller.ts`, `*.routes.ts`                                                                         | Application, Ports                          |
| Application / Domain      | `*.service.ts`, `*.orchestrator.ts`                                                                      | Ports, Contracts, Platform (config/logger)  |
| Ports                     | `notifier.ts`, `release.handler.ts`, `scheduler.ts` interfaces                                           | —                                           |
| Infrastructure / Adapters | `*.model.ts`, `http-client.ts`, `*-notifier.ts`, `outbox.relay.ts`, `*.consumer.ts`, `NodeCronScheduler` | Ports, Platform, Contracts                  |
| Platform (shared infra)   | `src/platform/**`                                                                                        | leaf — must **not** import `src/modules/**` |
| Composition root          | `src/container.ts`, `src/app.ts`, `src/index.ts`                                                         | everything (wiring)                         |

## Enforced invariants

ts-arch analyses **direct import edges** between project files, so it owns the
file→file direction and cycle rules. It cannot inspect `node_modules` imports or
express "only via the barrel", so those two go to ESLint.

| #   | Invariant                                                                                                                                           | Enforced by                                                            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | No dependency cycles among `src` files                                                                                                              | ts-arch                                                                |
| 2   | Infrastructure (`*.model.ts`) must not depend on presentation (`*.controller.ts`, `*.routes.ts`)                                                    | ts-arch                                                                |
| 3   | Application (`*.service.ts`, `*.orchestrator.ts`) must not depend on presentation                                                                   | ts-arch                                                                |
| 4   | Application must not depend on `src/platform/http` (the Express layer)                                                                              | ts-arch                                                                |
| 5   | `src/platform/**` must not depend on `src/modules/**` (no inverted dependency)                                                                      | ts-arch                                                                |
| 6   | Application must not import infra libs directly (`express`, `knex`, `pg`, `amqplib`, `@grpc/grpc-js`, `nodemailer`, `node-cron`) — depend on a port | ESLint `@typescript-eslint/no-restricted-imports`                      |
| 7   | Cross-module imports only via the `index.ts` barrel                                                                                                 | ESLint `@typescript-eslint/no-restricted-imports` (specifier patterns) |

Invariant 6 is why `ScannerService` receives a `Scheduler` port
([src/platform/scheduler.ts](../src/platform/scheduler.ts)) instead of importing
`node-cron` — the `NodeCronScheduler` adapter is wired in the composition root.

## Where it lives

- **ts-arch tests:** [`tests/architecture/layers.arch.test.ts`](../tests/architecture/layers.arch.test.ts)
  — a Jest project (`arch`) that reads `tsconfig.json` (production source only,
  tests excluded).
- **ESLint rules:** the two boundary blocks at the end of
  [`eslint.config.js`](../eslint.config.js).

## Running

```bash
npm run test:arch      # ts-arch fitness functions only
npm run test:unit      # unit + notification + arch
npm run lint           # includes the ESLint boundary rules (invariants 6 & 7)
```

Both run in CI via the existing `quality` (lint) and test steps.

## Adding a new rule

- **A layer/direction or cycle rule** → add an `it(...)` to `layers.arch.test.ts`,
  build the rule with
  `filesOfProject('tsconfig.json').matchingPattern(A).shouldNot().dependOnFiles().matchingPattern(B)`,
  then assert `expect(await rule.check()).toEqual([])`.
  Patterns are regexes matched against forward-slash-normalised relative paths.
  Prefer `matchingPattern` over `inFolder` (the latter builds a `/`-separated regex
  that historically mismatched Windows paths).
- **A "don't import package X" or barrel rule** → extend `INFRA_LIBS` or the
  `barrelOnlyPatterns` in `eslint.config.js`.

After adding a rule, confirm it actually bites: temporarily introduce the forbidden
import and check that `npm run test:arch` (or `npm run lint`) fails, then revert.
