# Release Owl 🦉

A service that watches GitHub repositories and notifies subscribers via email whenever a new release is published.

**Live demo:** [releaseowl.stashohulia.dev](https://releaseowl.stashohulia.dev/) — API Key: `a3f8c2e1d4b7a9f0e5c8d2b1a6f3e9c4d7b0a2e5f8c1d4b7a0e3f6c9d2b5a8`

## What It Does

Users subscribe with their **email** and a GitHub **`owner/repo`** slug. The service:

1. Validates the repository exists via the GitHub REST API.
2. Stores the pending subscription in PostgreSQL and generates secure confirm / unsubscribe tokens.
3. Sends a **confirmation email** via SMTP; the user clicks the link to activate the subscription.
4. A **cron-driven scanner** periodically fetches the latest release for every subscribed repository and **emails all confirmed subscribers** when a new tag is detected.
5. Exposes a simple **static landing page** (`/`) and a **Swagger UI** (`/api/docs`) for the REST API.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime / Language | Node.js 20, TypeScript (ESM, `"type": "module"`) |
| HTTP Framework | Express 5 |
| Database | PostgreSQL 16, Knex (query builder), `pg` driver |
| Validation | Zod |
| Email | Nodemailer (SMTP) |
| GitHub API | Native `fetch` against GitHub REST API |
| Scheduling | node-cron |
| Logging | Pino + pino-http |
| API Docs | swagger-ui-express + `swagger.yaml` (OpenAPI 2.0) |
| Security | Helmet, CORS, express-rate-limit, optional `X-API-Key` middleware |
| Testing | Jest, Supertest (unit + integration projects) |
| Linting / Formatting | ESLint, Prettier, Husky + lint-staged |
| Containerisation | Docker (multi-stage, Alpine), Docker Compose, Caddy (TLS reverse proxy) |
| Logging & Observability | Pino (JSON logs), Filebeat (log shipping), Elasticsearch (storage), Kibana (UI) |
| CI/CD | GitHub Actions → images pushed to GHCR → deployed over SSH via Docker Compose production profile |

---

## Architecture

The codebase follows a classic **layered (MVC-style)** structure:

```
Routes → Controllers → Services → Models / External Services
```

### Layers

- **Routes** (`src/routes/`) — declare HTTP endpoints and attach middleware.
- **Controllers** (`src/controllers/`) — parse & validate requests with Zod, delegate to services, and map results to HTTP responses.
- **Services** (`src/services/`) — orchestrate business logic:
  - `subscriptionService` — subscription lifecycle (create, confirm, unsubscribe, list).
  - `scannerService` — cron job that polls GitHub and dispatches email notifications.
  - `githubService` — thin wrapper around the GitHub REST API.
  - `emailService` — sends confirmation and notification emails via Nodemailer.
- **Models** (`src/models/`) — encapsulate all SQL/Knex queries (repository pattern).
- **Middleware** (`src/middleware/`) — `apiKeyAuth` (optional, timing-safe), `errorHandler` (maps `ZodError` / `AppError` / generic errors to JSON).
- **Config** (`src/config/`) — central config object built from env variables; fails fast on missing required values.

### Key Architectural Decisions

| Decision | Rationale |
|---|---|
| **In-process scheduler** | `node-cron` runs the scanner inside the same Node process — simple to operate without a separate worker service. |
| **Token-based double opt-in** | Subscriptions require email confirmation via a cryptographically random token before notifications are sent. |
| **`last_seen_tag` on repositories** | A shared `repositories` table tracks the latest known release tag; all subscribers to the same repo benefit from a single GitHub API call per scan cycle. |
| **Fail-fast config** | Required env variables throw at startup, preventing silent misconfiguration in production. |
| **Knex migrations** | Schema changes are versioned and run automatically by the Docker entrypoint (`migrate.js` before `index.js`). |
| **Caddy as optional TLS proxy** | Caddy is gated behind a Docker Compose `production` profile, keeping the development setup simple. |

---

## Project Structure

```
src/
├── app.ts                  # Express app setup (middleware, routes, Swagger)
├── index.ts                # Entry point — starts the server and scanner
├── config/index.ts         # Environment config (fail-fast)
├── controllers/            # HTTP controllers
├── services/               # Business logic & external integrations
├── models/                 # Database queries (Knex)
├── routes/                 # Route declarations
├── middleware/             # apiKeyAuth, errorHandler
├── schemas/                # Zod validation schemas
├── db/
│   ├── knex.ts             # Knex client singleton
│   └── migrations/         # SQL migrations
├── errors.ts               # Custom error classes
├── types.ts                # Shared TypeScript interfaces
└── utils/logger.ts         # Pino logger
tests/
└── integration/            # Supertest integration tests
public/
└── index.html              # Static subscribe form
swagger.yaml                # OpenAPI 2.0 specification
Dockerfile                  # Multi-stage production build
docker-compose.yml          # app + db (+ caddy production profile)
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker & Docker Compose
- An SMTP account (Gmail, Resend, Mailgun, etc.)

### Local Development

```bash
# 1. Clone and install dependencies
git clone <repo-url>
cd genesis-ses-case
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — at minimum set DATABASE_URL, SMTP_*, BASE_URL

# 3. Start the database
docker compose up db -d

# 4. Run migrations
npm run migrate

# 5. Start the dev server (with hot reload)
npm run dev
```

The API is available at `http://localhost:3000` and Swagger UI at `http://localhost:3000/api/docs`.

### Running with Docker Compose

```bash
cp .env.example .env
# Edit .env

docker compose up --build
```

To enable HTTPS via Caddy (set `DOMAIN` in `.env` first):

```bash
docker compose --profile production up --build
```

### Production deployment

Images are built by GitHub Actions and pushed to GHCR; the server only pulls
them, so a 2 GB VPS is enough to deploy (no compilation on the host).

One-time host setup:

```bash
docker network create edge
```

The `edge` network is shared with the [ustriy-system](https://github.com/Hradivnyk/ustriy-system)
stack: this project's Caddy terminates TLS for both domains, so only one service
binds ports 80/443. Set `USTRIY_DOMAIN` in `.env` (or leave the default if that
project is not deployed here) and `IMAGE_PREFIX=ghcr.io/<owner>/<repo>`.

Required GitHub secrets: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_WORK_DIR`.
`IMAGE_TAG` is passed automatically as the commit SHA, so rolling back is
`IMAGE_TAG=<sha> docker compose --profile production up -d`.

### Logging (ELK Stack)

The stack includes Filebeat → Elasticsearch → Kibana for log aggregation, gated
behind the `observability` profile so the default stack stays under ~1.5 GB RAM
and fits on a small VPS. Starting the profile adds roughly 1.5–2 GB.

```bash
docker compose --profile observability up -d
```

While the profile is stopped, `/kibana` returns 502 — everything else is unaffected.

**Local development** — Kibana UI is available at `http://localhost:5601` when using the override file:

```bash
cp docker-compose.override.yml.example docker-compose.override.yml
docker compose --profile observability up --build
```

**Production** — Kibana is accessible at `https://<DOMAIN>/kibana` and is protected by basic auth. No extra DNS configuration is needed. Set `KIBANA_USER` and `KIBANA_HASHED_PASSWORD` in `.env`:

```bash
# Generate password hash
docker run --rm caddy:2-alpine caddy hash-password --plaintext yourpassword
```

### Testing

See [testing.md](testing.md) for full details on unit, integration, and E2E tests.

```bash
npm run ci                    # full CI check: quality + all tests (requires Docker)
npm run quality               # lint, format, typecheck, build — no Docker needed
npm test                      # all tests: unit + integration + e2e (requires Docker)
npm run test:unit             # unit tests only
npm run test:unit:coverage    # unit tests with coverage report
```

---

## API Overview

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/subscribe` | Subscribe an email to a repository |
| `GET` | `/api/confirm/:token` | Confirm a subscription |
| `GET` | `/api/unsubscribe/:token` | Unsubscribe |
| `GET` | `/api/subscriptions` | List subscriptions for an email |

Full interactive documentation is available at `/api/docs`.

### Authentication

Set `API_KEY` in `.env`. When configured, all `/api/*` requests must include the header:

```
X-API-Key: <your-api-key>
```

Leave `API_KEY` empty to disable (not recommended in production).

---

## Environment Variables

See [`.env.example`](.env.example) for the full reference. Key variables:

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Yes | SMTP email config |
| `BASE_URL` | Yes | Used to build confirmation/unsubscribe links |
| `GITHUB_TOKEN` | No | Increases GitHub API rate limit from 60 → 5 000 req/h |
| `API_KEY` | No | Enables `X-API-Key` authentication |
| `SCANNER_CRON_SCHEDULE` | No | Cron expression for release checks (default: `0 * * * *`) |
| `KIBANA_USER` | No | Username for Kibana basic auth (production only) |
| `KIBANA_HASHED_PASSWORD` | No | Bcrypt-hashed password for Kibana (generate with `caddy hash-password`) |

---

## gRPC Transport (HW10)

### Overview

Release notification emails (sent by the scanner when a new GitHub release is published)
can be delivered via three transports, selected by the `NOTIFIER` env var on the **app** service:

| `NOTIFIER` | Transport | Notes |
|---|---|---|
| `broker` *(default)* | Async RabbitMQ `email.requested` → Saga | Full distributed transaction; confirmation email delivery guaranteed via transactional outbox. |
| `grpc` | Synchronous gRPC `NotificationService/Notify` | Caller blocks until email is sent or an error is returned. Bypasses the Saga. |
| `rest` | Synchronous HTTP `POST /api/notify` | REST baseline for comparison; same semantics as gRPC. Bypasses the Saga. |

The broker path and Saga are **unchanged** — `broker` remains the default and all existing subscription flows continue to work exactly as before.

### Proto Contract

Located at `packages/proto/proto/releaseowl/notification/v1/notification.proto`.
Generated TypeScript stubs live at `packages/proto/src/gen/` (committed; regenerate with `npm run generate`).

```protobuf
service NotificationService {
  rpc Notify(NotifyRequest) returns (NotifyResponse);
}
```

`NotifyRequest` carries a `oneof kind` — either `ConfirmationEmail` or `NotificationEmail`.

### gRPC Status Codes

| Situation | gRPC code |
|---|---|
| Missing / empty `kind` | `INVALID_ARGUMENT` |
| Missing required field (`email`, `repo`, …) | `INVALID_ARGUMENT` |
| Transient SMTP / network failure (`ECONNREFUSED`, `ETIMEDOUT`, …) | `UNAVAILABLE` |
| Any other send failure | `INTERNAL` |
| Success | `OK` (empty `NotifyResponse`) |

### Switching to gRPC

```bash
# Start with gRPC transport enabled
NOTIFIER=grpc docker compose up --build

# Verify with grpcurl (install: brew install grpcurl)
grpcurl -plaintext \
  -d '{"notification":{"email":"a@b.com","repo":"owner/repo","tagName":"v1","unsubscribeToken":"tok"}}' \
  localhost:50051 releaseowl.notification.v1.NotificationService/Notify
```

### buf

```bash
# Lint proto
npx buf lint

# Regenerate TypeScript stubs (requires @bufbuild/buf + ts-proto devDeps)
npm run generate
```

---

## gRPC vs REST Throughput Benchmark

Both paths are benchmarked with `EMAIL_SENDER=stub` (no-op sender) so that SMTP latency does not distort the transport comparison.

### Setup

```bash
# 1. Start only the notification service with stub sender and ports exposed
EMAIL_SENDER=stub docker compose up -d notification

# 2. Install ghz (binary, not npm): https://ghz.sh/
#    macOS: brew install ghz
#    Linux: download from https://github.com/bojand/ghz/releases

# 3. Run benchmarks (from repo root)
sh bench/bench-grpc.sh    # gRPC  — 20 000 requests, 50 concurrent
sh bench/bench-rest.sh    # REST  — 20 000 requests, 50 concurrent
```

### Results

> Measured on Apple M2 Pro, Node.js 20, Docker Desktop (mac), `EMAIL_SENDER=stub`.
> Your numbers will vary; re-run with the scripts above.

| Metric | gRPC | REST |
|---|---|---|
| Requests/sec | — | — |
| Latency p50 | — | — |
| Latency p95 | — | — |
| Latency p99 | — | — |

*(Fill in after running `bench/bench-grpc.sh` and `bench/bench-rest.sh`.)*

**Expected trade-offs:** gRPC uses HTTP/2 multiplexing and binary Protocol Buffers encoding,
which typically yields lower per-request overhead at high concurrency compared to HTTP/1.1 + JSON.
With a stub sender the difference is dominated by serialisation and transport framing rather than I/O.
