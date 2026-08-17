# System Design: Release Owl

## Table of Contents

1. [System Overview](#1-system-overview)
2. [System Requirements](#2-system-requirements)
3. [Constraints](#3-constraints)
4. [High-Level Architecture](#4-high-level-architecture)
5. [Component Design](#5-component-design)
6. [RabbitMQ Event Contracts](#6-rabbitmq-event-contracts)
7. [Testing and CI](#7-testing-and-ci)
8. [Future Work](#8-future-work)

**Detailed docs:**

- [Orchestrated Saga](saga.md) — sequence diagrams, compensation, idempotency
- [Data Model](data-model.md) — schemas, ER diagram, migrations
- [Observability](observability.md) — logging, metrics, alerting
- [REST API](../swagger.yaml) — OpenAPI / Swagger spec

---

## 1. System Overview

**Release Owl** is an HTTP service that allows users to subscribe to email notifications about new releases of GitHub repositories. The service periodically polls the GitHub API and sends emails to subscribers when a new release tag is detected.

Two runtime services communicate via RabbitMQ:

- **`app`** — API server, release scanner, and **Saga orchestrator**. Handles subscriptions, validates repos via GitHub API, detects new releases, drives the subscribe→email-delivered distributed transaction.
- **`notification`** — standalone microservice with its **own PostgreSQL database**. Consumes `email.requested` commands, delivers emails via SMTP, publishes `email.sent` / `email.failed` saga reply events.

```mermaid
flowchart TD
    subgraph Sub["Subscription Saga (on demand)"]
        A[User] -->|POST /api/subscribe| B[Repository validation\nGitHub API]
        B --> C[Persist subscription + saga + outbox event\natomic DB transaction]
        C --> D[Outbox relay → RabbitMQ]
        D --> E{Notification service\nsends confirmation email}
        E -->|success| F[email.sent → saga completed]
        E -->|retries exhausted| G[email.failed → subscription deleted\nSaga compensated]
        F --> H[User confirms subscription]
    end

    subgraph Scan["Scanner Flow (scheduled, every hour)"]
        I["[cron] Scheduler"] --> J[Fetch all confirmed subscriptions]
        J --> K[GitHub API — check latest release]
        K -->|new release detected| L[Publish email.requested → RabbitMQ]
        L --> M[Notification service sends release email]
        K -->|no new release| N[Skip]
    end
```

---

## 2. System Requirements

### Functional

| #    | Requirement                                                      |
| ---- | ---------------------------------------------------------------- |
| F-01 | Subscribe by email + `owner/repo`                                |
| F-02 | Validate repository via GitHub REST API before persisting        |
| F-03 | Double opt-in: subscription active only after email confirmation |
| F-04 | Confirmation email sent after subscribe (via Saga)               |
| F-05 | Email notifications to all confirmed subscribers on new release  |
| F-06 | Each notification email contains an unsubscribe link             |
| F-07 | Unsubscribe at any time via token link                           |
| F-08 | API to list subscriptions for an email                           |
| F-09 | `(email, repo)` unique — duplicate returns 409                   |
| F-10 | Static landing page for subscribe without API                    |
| F-11 | Swagger UI at `/api/docs`                                        |

### Non-Functional

| Category            | Requirement                          | Target                                                             |
| ------------------- | ------------------------------------ | ------------------------------------------------------------------ |
| **Availability**    | Service uptime                       | ≥ 99% (single-instance EC2)                                        |
| **Scalability**     | Number of monitored repositories     | Up to 1,000 without architectural changes                          |
| **Reliability**     | Confirmation email delivery          | Transactional outbox guarantees at-least-once delivery to broker   |
| **Reliability**     | Consistency (pending subscription)   | Orchestrated Saga: compensates on permanent email failure          |
| **Reliability**     | SMTP transient failures              | Notification service retries with exponential backoff (3 attempts) |
| **Reliability**     | Single email send failure            | Does not stop processing other subscribers (`Promise.allSettled`)  |
| **Reliability**     | Scanner crash                        | Does not affect HTTP request handling (graceful logging)           |
| **Reliability**     | Broker connection loss               | `RabbitMQBroker` reconnects automatically (up to 10 retries)       |
| **Security**        | Brute-force protection               | Rate limiting: 100 req / 15 min / IP                               |
| **Security**        | API endpoint protection              | `X-API-Key` with timing-safe comparison (required)                 |
| **Security**        | Transport                            | TLS via Caddy (Let's Encrypt) in production                        |
| **Configurability** | Start without required env variables | Fail-fast on startup                                               |
| **Maintainability** | Structured JSON logging              | Pino, DEBUG/INFO/ERROR levels                                      |
| **Testability**     | Unit + integration test coverage     | Jest + Supertest                                                   |

---

## 3. Constraints

### Technical Constraints

- **GitHub API rate limit without a token:** 60 requests/hour per IP. With N unique repositories on an hourly cron schedule, the system can process at most 60 repos without `GITHUB_TOKEN`. With a token — 5,000 requests/hour.
- **In-process scheduler:** `node-cron` runs in the same Event Loop as the HTTP server. A long scan cycle can delay HTTP request handling with a large number of repositories.
- **No retry mechanism for GitHub requests:** transient GitHub API failures result in a missed notification until the next cron tick.
- **No horizontal scaling:** single process + single DB instance. Running multiple instances will cause duplicate notifications (see [Future Work](#8-future-work)).
- **At-least-once delivery via outbox:** the outbox relay may re-publish an event if it crashes after publishing but before marking the row as published. The notification service handles duplicates via inbox deduplication (`saga_id` PK).

### Business Constraints

- The service monitors only **public GitHub repositories** (no OAuth for private repos).
- Only **official GitHub releases** (`/releases/latest`) are tracked — not tags or pre-releases.
- Only **one active subscription** per `(email, repo)` pair is supported.

### Infrastructure Constraints

- Deployed on a **single EC2 instance** (no load balancer, no auto-scaling).
- Database — **single-node PostgreSQL** with no replicas and no backup beyond the Docker volume.
- Message broker — **single-node RabbitMQ** with a persistent durable queue, no DLQ configured.

---

## 4. Load Estimation

### 4.1 Users and Traffic

| Metric                     | Estimate | Note                                       |
| -------------------------- | -------- | ------------------------------------------ |
| Active subscribers         | ~1,000   | MVP target audience                        |
| Unique repositories        | ~300     | Some subscribers follow the same repo      |
| New subscriptions / day    | ~20      | `POST /api/subscribe`                      |
| Confirmations / day        | ~18      | ~90% conversion rate                       |
| Subscription lookups / day | ~10      | `GET /api/subscriptions`                   |
| GitHub API requests / hour | ~300     | 1 request × 300 repos × 1 time/hour        |
| Email notifications / hour | ~50      | ~5% of repos having a new release per hour |

### 4.2 Data

| Table           | Row size (estimate) | Rows                | Volume                     |
| --------------- | ------------------- | ------------------- | -------------------------- |
| `repositories`  | ~100 bytes          | 300                 | ~30 KB                     |
| `subscriptions` | ~300 bytes          | 1,000               | ~300 KB                    |
| `outbox`        | ~500 bytes          | ~20/day (transient) | Rows deleted after publish |

**Growth:** +20 subscriptions/day = 6 KB/day → **2 MB/year**. PostgreSQL thresholds are not a concern at any realistic volume.

### 4.3 Bandwidth

| Direction                    | Estimate          | Calculation                   |
| ---------------------------- | ----------------- | ----------------------------- |
| Inbound HTTP traffic         | ~5 KB/hour        | ~20 req × ~250 bytes/req      |
| Outbound to GitHub API       | ~90 KB/hour       | 300 req × ~300 bytes response |
| Outbound email notifications | ~50 KB/hour       | 50 emails × ~1 KB/email       |
| **Total**                    | **< 200 KB/hour** | Not a bottleneck              |

---

## 5. High-Level Architecture

```mermaid
flowchart TB
    subgraph EC2["EC2 Instance"]
        Caddy["Caddy (TLS)\n:80 / :443"]
        App["Node.js App\n(app service)"]
        Notification["Node.js\n(notification service)"]
        PG[("PostgreSQL 16\napp DB")]
        NotifPG[("PostgreSQL 16\nnotification DB")]
        RabbitMQ[("RabbitMQ 3.13")]
        Filebeat["Filebeat"]
        ES[("Elasticsearch")]
        Kibana["Kibana\n(/kibana)"]
        ESInit["es-init\n(one-shot)"]
        Caddy <-->|":3000"| App
        Caddy <-->|":5601"| Kibana
        Caddy <-->|":3000/grafana"| Grafana["Grafana\n(/grafana)"]
        App --> PG
        Notification --> NotifPG
        App -->|"email.requested"| RabbitMQ
        Notification -->|"email.sent / email.failed"| RabbitMQ
        Notification -->|"consume email.requested"| RabbitMQ
        App -->|"consume email.sent / email.failed"| RabbitMQ
        Filebeat -->|"JSON logs"| ES
        Kibana --> ES
        ESInit -->|"PUT /_index_template"| ES
        Prometheus["Prometheus"] -->|"scrape /metrics"| App
        Grafana --> Prometheus
    end
    GitHub["GitHub REST API"]
    SMTP["SMTP Server"]
    Docker["Docker log files"]
    App --> GitHub
    Notification --> SMTP
    Docker -->|"container logs"| Filebeat
```

> Sequence diagrams for the Saga flows: → [saga.md](saga.md)

### Scanner Flow

```mermaid
sequenceDiagram
    participant Scheduler
    participant ScannerService
    participant GitHubAPI as GitHub API
    participant DB
    participant BrokerNotifier
    participant RabbitMQ
    participant NotificationService
    participant SMTP

    Scheduler->>ScannerService: scan()
    ScannerService->>DB: findAllConfirmedWithTokens()
    ScannerService->>GitHubAPI: GET /repos/{repo}/releases/latest
    GitHubAPI-->>ScannerService: new release tag
    ScannerService->>BrokerNotifier: sendNotificationEmail (per subscriber)
    BrokerNotifier->>RabbitMQ: publish email.requested
    RabbitMQ-->>NotificationService: email.requested
    NotificationService->>SMTP: sendNotificationEmail (with retry)
    ScannerService->>DB: updateLastSeenTag
```

---

## 5. Component Design

### 5.1 HTTP Server (Express 5)

Middleware pipeline (in order):

```text
express.static(public/)   → landing page
helmet()                  → security headers
cors()                    → CORS allowlist
rateLimit(100/15min/IP)   → brute-force protection
pinoHttp()                → structured request logging
express.json/urlencoded() → body parsing
swagger-ui (/api/docs)    → OpenAPI docs
subscriptionRoutes (/api) → business endpoints
errorHandler()            → centralized error mapping
```

Errors: `ZodError` → 400; custom `AppError` subclasses → their HTTP codes; unexpected → 500.

### 5.2 Subscription Service

| Method                    | Action                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| `subscribe(email, repo)`  | Validate repo → check duplicate → atomically INSERT subscription + saga row + outbox event |
| `confirm(token)`          | Validate format → UPDATE status=confirmed                                                  |
| `unsubscribe(token)`      | Validate format → DELETE subscription                                                      |
| `getSubscriptions(email)` | Return all confirmed subscriptions                                                         |

The three writes in `subscribe` share one transaction — subscription, saga state, and the email command commit or roll back together.

| Method                    | Action                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `subscribe(email, repo)`  | Validates repo → checks for duplicate → generates tokens (`crypto.randomBytes(32)`) → persists subscription + outbox event in one DB transaction |
| `confirm(token)`          | Validates token format (hex 64) → updates status to `confirmed`                                                                                  |
| `unsubscribe(token)`      | Validates format → deletes the subscription row                                                                                                  |
| `getSubscriptions(email)` | Returns all subscriptions for the given email                                                                                                    |

See [saga.md](saga.md) for full detail and sequence diagrams.

| Component                      | Role                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| `SagaReplyConsumer`            | Subscribes to `email.sent` / `email.failed` reply queues                               |
| `SubscriptionSagaOrchestrator` | `email.sent` → mark completed; `email.failed` → delete subscription + mark compensated |
| `SubscriptionSagaModel`        | CRUD on `subscription_sagas`                                                           |

### 5.4 Notification Service

See [saga.md](saga.md) for the participant flow.

| Component                     | Role                                                                 |
| ----------------------------- | -------------------------------------------------------------------- |
| `EmailRequestedConsumer`      | Consumes `email.requested`; saga participant for `confirmation` type |
| `InboxModel`                  | Deduplicates by `saga_id` — exactly-once send per command            |
| `OutboxModel` / `OutboxRelay` | Reliably publishes `email.sent` / `email.failed` replies             |
| `RetryingEmailSender`         | Exponential backoff (default 3 attempts, 500 ms initial)             |
| `EmailTemplateBuilder`        | Renders confirmation and notification email text                     |

Release notification emails (`type: 'notification'`) remain fire-and-forget — no saga, no reply.

### 5.5 Outbox Relay (both services)

Polls every `OUTBOX_POLL_INTERVAL_MS` (default 1 000 ms). Claims rows with `SELECT … FOR UPDATE SKIP LOCKED` in batches of `OUTBOX_BATCH_SIZE` (default 50). Claim + publish + mark-published run in one transaction → at-least-once delivery. Skips a cycle if the previous drain is still running.

### 5.6 Scanner Service

Cron job (`SCANNER_CRON_SCHEDULE`, default `0 * * * *`):

1. Load all confirmed subscriptions with `last_seen_tag`.
2. Group by `repo` → 1 GitHub API call per repo.
3. Compare `release.tag_name` vs `last_seen_tag`.
4. On new release: publish `email.requested` per subscriber via `BrokerNotifier` (`Promise.allSettled` — one failure doesn't stop the rest).
5. Update `last_seen_tag`.

| Event routing key | Producer                       | Consumer               | Queue                          |
| ----------------- | ------------------------------ | ---------------------- | ------------------------------ |
| `email.requested` | `app` (outbox relay / scanner) | `notification` service | `notification.email-requested` |

| Method                   | Endpoint                                    | Behavior                                                        |
| ------------------------ | ------------------------------------------- | --------------------------------------------------------------- |
| `repositoryExists(repo)` | `GET /repos/{owner}/{repo}`                 | 200 → true, 404 → false, 429/403 → throw `GitHubRateLimitError` |
| `getLatestRelease(repo)` | `GET /repos/{owner}/{repo}/releases/latest` | 200 → `{tag_name}`, 404 → null, 429/403 → throw                 |

`Retry-After` header takes priority over `X-RateLimit-Reset` for rate-limit reset time.

Thin wrapper around GitHub REST API v2022-11-28:

| Method                   | Endpoint                                    | Behavior                                                                        |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------- |
| `repositoryExists(repo)` | `GET /repos/{owner}/{repo}`                 | `200` → true, `404` → false, `429`/`403` → throw `GitHubRateLimitError`         |
| `getLatestRelease(repo)` | `GET /repos/{owner}/{repo}/releases/latest` | `200` → `{tag_name, html_url}`, `404` → null (no releases), `429`/`403` → throw |

**Rate limit handling:** both primary and secondary rate limits can return either `403` or `429`. The `handleRateLimit` method determines `resetAt` using the following priority (per GitHub docs):

1. `Retry-After` header (seconds) — present on secondary rate limit responses; takes priority.
2. `X-RateLimit-Reset` header (Unix seconds) — present when the primary rate limit is exhausted.
3. Fallback: `now + 60 s`.

Without `GITHUB_TOKEN` — 60 req/hour; with token — 5,000 req/hour.

### 6.7 Notification Service

Standalone Node.js process (`services/notification`). Responsibilities:

| Component                | Role                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `EmailRequestedConsumer` | Subscribes to `email.requested` on RabbitMQ; dispatches to email sender             |
| `RetryingEmailSender`    | Wraps Nodemailer; retries transient SMTP failures with exponential backoff          |
| `EmailTemplateBuilder`   | Renders confirmation and notification email HTML                                    |
| Health server            | Minimal HTTP server on `:3002` — returns `{"status":"ok"}` for Docker health checks |

Email types:

| Type         | Subject                     | Content                                                              |
| ------------ | --------------------------- | -------------------------------------------------------------------- |
| Confirmation | `Confirm your subscription` | Link `{BASE_URL}/api/confirm/{token}`                                |
| Notification | `New release: {repo} {tag}` | Release link + unsubscribe link `{BASE_URL}/api/unsubscribe/{token}` |

SMTP retry policy: up to `EMAIL_RETRY_ATTEMPTS` (default: 3) attempts with initial backoff `EMAIL_RETRY_BACKOFF_MS` (default: 500 ms), doubling on each failure.

### 6.8 Config Module

**`app` service** — fail-fast validation on startup:

```env
DATABASE_URL              → required
RABBITMQ_URL              → optional (default: amqp://localhost:5672)
API_KEY                   → required (enables X-API-Key auth)
GITHUB_TOKEN              → optional (increases rate limit to 5,000/hour)
BASE_URL                  → optional (default: http://localhost:3000)
ALLOWED_ORIGIN            → optional (default: '*')
PORT                      → optional (default: 3000)
SCANNER_CRON_SCHEDULE     → optional (default: '0 * * * *')
OUTBOX_POLL_INTERVAL_MS   → optional (default: 1000)
OUTBOX_BATCH_SIZE         → optional (default: 50)
```

**`notification` service** — fail-fast validation on startup:

```env
DATABASE_URL              → required (own PostgreSQL)
RABBITMQ_URL              → optional (default: amqp://localhost:5672)
SMTP_HOST                 → required
SMTP_PORT                 → optional (default: 587)
SMTP_USER                 → required
SMTP_PASS                 → required
SMTP_FROM                 → required
BASE_URL                  → optional (default: http://localhost:3000)
EMAIL_RETRY_ATTEMPTS      → optional (default: 3)
EMAIL_RETRY_BACKOFF_MS    → optional (default: 500)
HEALTH_PORT               → optional (default: 3002)
OUTBOX_POLL_INTERVAL_MS   → optional (default: 1000)
OUTBOX_BATCH_SIZE         → optional (default: 50)
```

---

## 6. RabbitMQ Event Contracts

Exchange: `release-owl.events` (topic, durable). All messages persistent.

| Routing key       | Producer                     | Consumer           | Queue                          |
| ----------------- | ---------------------------- | ------------------ | ------------------------------ |
| `email.requested` | `app` outbox relay / scanner | `notification`     | `notification.email-requested` |
| `email.sent`      | `notification` outbox relay  | `app` orchestrator | `app.email-sent`               |
| `email.failed`    | `notification` outbox relay  | `app` orchestrator | `app.email-failed`             |

-- User subscriptions
CREATE TABLE subscriptions (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
email TEXT NOT NULL,
repo TEXT NOT NULL REFERENCES repositories(repo) ON DELETE CASCADE,
confirm_token TEXT NOT NULL UNIQUE, -- hex 64 chars, crypto.randomBytes(32)
unsubscribe_token TEXT NOT NULL UNIQUE, -- hex 64 chars, crypto.randomBytes(32)
status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'confirmed'

UNIQUE (email, repo)
);

-- Transactional outbox for broker events
CREATE TABLE outbox (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
routing_key TEXT NOT NULL,
payload JSONB NOT NULL,
created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
published_at TIMESTAMPTZ, -- NULL = not yet published
attempts INTEGER NOT NULL DEFAULT 0
);
-- Index used by the relay to find unpublished rows oldest-first
CREATE INDEX outbox_unpublished_idx ON outbox (published_at, created_at);

````

### ER Diagram

```mermaid
erDiagram
    repositories {
        TEXT repo PK
        TEXT last_seen_tag
    }
    subscriptions {
        UUID id PK
        TEXT email
        TEXT repo FK
        TEXT confirm_token "UNIQUE"
        TEXT unsubscribe_token "UNIQUE"
        TEXT status
    }
    outbox {
        UUID id PK
        TEXT routing_key
        JSONB payload
        TIMESTAMPTZ created_at
        TIMESTAMPTZ published_at
        INTEGER attempts
    }
    repositories ||--o{ subscriptions : "has"
````

### Migrations

Managed via Knex migrations (`src/platform/db/migrations/`). Applied automatically on container start via `docker-entrypoint.sh`:

```sh
node dist/migrate.js   # knex migrate:latest
node dist/index.js     # start the service
```

| Migration file                                 | Change                                            |
| ---------------------------------------------- | ------------------------------------------------- |
| `001_create_repositories_and_subscriptions.ts` | Creates `repositories` and `subscriptions` tables |
| `002_create_outbox.ts`                         | Creates `outbox` table with relay index           |

---

## 8. API Integration

### 8.1 REST API Reference

**Base URL:** `/api`  
**Content-Type:** `application/json` or `application/x-www-form-urlencoded`  
**Auth:** `X-API-Key: <key>` (`API_KEY` is required)

---

#### `POST /api/subscribe`

Subscribe to release notifications for a repository.

**Request:**

```json
{ "email": "user@example.com", "repo": "golang/go" }
```

**Responses:**

| Status             | Description                                         |
| ------------------ | --------------------------------------------------- |
| `200 OK`           | Subscription created, confirmation email queued     |
| `400 Bad Request`  | Invalid email or repo format                        |
| `401 Unauthorized` | Missing or invalid API key                          |
| `404 Not Found`    | Repository not found on GitHub                      |
| `409 Conflict`     | This email is already subscribed to this repository |

---

#### `GET /api/confirm/:token`

Confirm a subscription using the token from the confirmation email.

**Path param:** `token` — 64-character hex string

**Responses:**

| Status            | Description            |
| ----------------- | ---------------------- |
| `200 OK`          | Subscription confirmed |
| `400 Bad Request` | Invalid token format   |
| `404 Not Found`   | Token not found        |

> **Note on HTTP semantics:** RFC 9110 requires `GET` to be safe and idempotent (no state mutation). This endpoint intentionally violates that constraint because confirmation links are opened directly by the browser from an email — there is no opportunity to use `POST` without serving an intermediate HTML page. The trade-off is accepted for simplicity at the MVP stage. A stricter alternative would be: `GET /api/confirm/:token` renders an HTML page with a "Confirm" button, which submits `POST /api/confirm/:token` to perform the actual state change.

---

#### `GET /api/unsubscribe/:token`

Unsubscribe using the token from a notification email.

**Path param:** `token` — 64-character hex string

**Responses:**

| Status            | Description               |
| ----------------- | ------------------------- |
| `200 OK`          | Successfully unsubscribed |
| `400 Bad Request` | Invalid token format      |
| `404 Not Found`   | Token not found           |

> **Note on HTTP semantics:** same trade-off as `GET /api/confirm/:token` above — the unsubscribe link is embedded in notification emails and must work with a single browser `GET`. A fully RFC-compliant design would serve an HTML confirmation page first and perform the deletion via `POST`.

---

#### `GET /api/subscriptions?email=...`

Get all active subscriptions for an email address.

**Query param:** `email` — email address

**Response `200`:**

```json
[
  {
    "email": "user@example.com",
    "repo": "golang/go",
    "confirmed": true,
    "last_seen_tag": "go1.22.0"
  }
]
```

---

### 8.2 GitHub REST API Integration

| Purpose                    | Endpoint                                                      | Method |
| -------------------------- | ------------------------------------------------------------- | ------ |
| Check repository existence | `https://api.github.com/repos/{owner}/{repo}`                 | GET    |
| Get latest release         | `https://api.github.com/repos/{owner}/{repo}/releases/latest` | GET    |

**Headers:**

```http
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
Authorization: Bearer {GITHUB_TOKEN}   (optional)
```

**Rate limits:**

| Mode                | Limit                |
| ------------------- | -------------------- |
| Without token       | 60 req/hour (per IP) |
| With `GITHUB_TOKEN` | 5,000 req/hour       |

When the rate limit is exceeded (status 429), the service throws `GitHubRateLimitError` and logs the reset time from `X-RateLimit-Reset`.

### 8.3 RabbitMQ Event Contract

**Exchange:** `release-owl.events` (topic, durable)

#### `email.requested`

Published by the `app` service (via outbox relay for confirmations; directly for release notifications). Consumed by the `notification` service from queue `notification.email-requested` (durable).

**Payload** (discriminated union on `type`):

```typescript
// email.requested — confirmation (carries saga_id)
{ type: "confirmation", email, repo, confirm_token, saga_id: string }

// email.requested — release notification (fire-and-forget)
{ type: "notification", email, repo, tag_name, unsubscribe_token }

// email.sent / email.failed
{ saga_id: string, repo: string }
{ saga_id: string, repo: string, reason: string }
```

---

## 7. Testing and CI

### Test Layers

| Layer       | Tool                 | Scope                                                 |
| ----------- | -------------------- | ----------------------------------------------------- |
| Unit        | Jest                 | Business logic in isolation (mocked DB, broker, SMTP) |
| Integration | Jest + Supertest     | Full HTTP cycle against real test DB                  |
| E2E         | Playwright + Mailhog | Browser → subscribe → confirm email in MailHog        |

### Unit Test Files

| File                                                                   | What is tested                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/modules/subscriptions/__tests__/subscription.service.test.ts`     | subscribe (with saga), confirm, unsubscribe, duplicate detection                |
| `src/modules/sagas/__tests__/subscription-saga.orchestrator.test.ts`   | `onEmailSent` → completed; `onEmailFailed` → delete + compensated; idempotency  |
| `src/modules/sagas/__tests__/saga-reply.consumer.test.ts`              | Routes `email.sent` / `email.failed` to orchestrator                            |
| `src/modules/releases/__tests__/scanner.service.test.ts`               | Scan cycle, release detection, notification dispatch                            |
| `src/modules/releases/__tests__/release.handler.test.ts`               | `Promise.allSettled` failure isolation, tag update                              |
| `src/modules/github/__tests__/github.service.test.ts`                  | Repo check, release fetch, rate-limit handling                                  |
| `src/modules/outbox/__tests__/outbox.relay.test.ts`                    | Drain batching, at-least-once publish                                           |
| `packages/platform/src/broker/__tests__/rabbitmq.broker.test.ts`       | Publish, subscribe, reconnect, dead-letter on failure                           |
| `services/notification/src/__tests__/email-requested.consumer.test.ts` | Saga path: email.sent on success; email.failed on exhaustion; inbox idempotency |
| `services/notification/src/__tests__/retrying-email.sender.test.ts`    | Retry backoff, exhaustion                                                       |

**Log pipeline:**

```text
Node.js (Pino JSON) → Docker log driver → Filebeat → Elasticsearch → Kibana
```

Filebeat reads container logs via the Docker socket and uses the `co.elastic.logs/*` labels on the `app` and `notification` containers to parse output as JSON. In production, Kibana is available at `https://<DOMAIN>/kibana` behind Caddy `basic_auth`.

**Index template (`es-init`):**

An `es-init` one-shot container (`curlimages/curl`) runs on every `docker compose up`, after Elasticsearch passes its health check. It applies the composable index template from `elasticsearch/index-template.json` via `PUT /_index_template/app-logs`. A `dynamic_template` maps any unmapped string field to `keyword` by default, preventing Elasticsearch from auto-guessing `text` for new fields.

### 9.2 Metrics (current)

Metrics are exposed at `GET /metrics` in Prometheus exposition format via **prom-client**. The endpoint is blocked externally by Caddy (`respond 404`) — only Prometheus scrapes it internally over the Docker network every 15 s.

**Metric pipeline:**

```text
Node.js (prom-client) → GET /metrics → Prometheus (scrape) → Grafana (visualise)
```

**Grafana** is available at `https://<DOMAIN>/grafana` behind Caddy `basic_auth`. On startup it auto-provisions Prometheus as the default datasource and loads the pre-built dashboard from `grafana/dashboards/github-scanner.json`.

| Metric                            | Type      | Labels                     | Description                              |
| --------------------------------- | --------- | -------------------------- | ---------------------------------------- |
| `http_requests_total`             | Counter   | method, route, status_code | Total HTTP requests                      |
| `http_request_duration_seconds`   | Histogram | method, route, status_code | Request latency — P50/P95/P99            |
| `github_api_requests_total`       | Counter   | operation, result          | GitHub API calls by operation and result |
| `subscription_operations_total`   | Counter   | operation, result          | Subscribe/confirm/unsubscribe outcomes   |
| `scanner_releases_detected_total` | Counter   | repo                       | New releases found per repository        |
| `scanner_emails_sent_total`       | Counter   | repo                       | Notification emails sent per repository  |
| `scanner_scan_duration_seconds`   | Histogram | result                     | Full scanner cycle duration              |

Default Node.js runtime metrics (CPU, heap, RSS, event-loop lag) are also collected via `collectDefaultMetrics()`.

### 9.3 Alerting (planned)

> Not yet implemented.

| Alert             | Condition                                        |
| ----------------- | ------------------------------------------------ |
| Service down      | No successful HTTP responses for > 2 min         |
| Scanner stalled   | No scan cycle completed within 2× cron interval  |
| GitHub rate limit | `github_api_errors_total{type="rate_limit"}` > 0 |
| High error rate   | HTTP 5xx rate > 1% over 5 min                    |

---

## 10. Testing and CI

### 10.1 Test Strategy

The project uses **Jest** as the test runner with **Supertest** for HTTP-layer integration tests.

| Layer       | Tool             | Scope                                                         |
| ----------- | ---------------- | ------------------------------------------------------------- |
| Unit        | Jest             | Individual service and middleware functions in isolation      |
| Integration | Jest + Supertest | Full HTTP request/response cycle against a real test database |

**Unit tests** (`src/**/__tests__/`, `services/**/__tests__/`) mock all external dependencies (database, GitHub API, broker) and verify business logic in isolation:

| File                                                                   | What is tested                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `src/modules/subscriptions/__tests__/subscription.service.test.ts`     | Subscribe, confirm, unsubscribe, duplicate detection, outbox enqueue       |
| `src/modules/releases/__tests__/scanner.service.test.ts`               | Scan cycle: grouping by repo, new release detection, notification dispatch |
| `src/modules/releases/__tests__/release.handler.test.ts`               | Release handling, `Promise.allSettled` failure isolation, tag update       |
| `src/modules/github/__tests__/github.service.test.ts`                  | Repository existence check, latest release fetch, rate limit handling      |
| `src/modules/notifications/__tests__/broker-notifier.test.ts`          | Broker publish calls for confirmation and notification events              |
| `src/modules/outbox/__tests__/outbox.relay.test.ts`                    | Outbox drain batching, at-least-once publish, concurrent drain skip        |
| `src/modules/subscriptions/__tests__/subscription.controller.test.ts`  | Request validation, error mapping to HTTP status codes                     |
| `src/platform/http/__tests__/api-key-auth.test.ts`                     | Timing-safe API key comparison, missing/invalid key rejection              |
| `packages/platform/src/broker/__tests__/rabbitmq.broker.test.ts`       | RabbitMQ publish, subscribe, reconnect, dead-letter on handler failure     |
| `services/notification/src/__tests__/email-requested.consumer.test.ts` | Consumer dispatch for confirmation/notification types                      |
| `services/notification/src/__tests__/retrying-email.sender.test.ts`    | Retry logic with exponential backoff, exhaustion behaviour                 |

**Integration tests** (`tests/integration/subscription.test.ts`) spin up the full Express application and verify end-to-end HTTP flows: subscribe → confirm → receive notification → unsubscribe. All external dependencies (broker, SMTP) are replaced with in-memory fakes, so the full suite runs without any external services.

### 10.2 CI Pipeline

Implemented in `.github/workflows/ci.yml` using GitHub Actions.

```mermaid
flowchart LR
    Trigger["Push / PR to main"]
    Trigger --> Build["build"]
    Trigger --> Lint["lint + format"]
    Trigger --> Typecheck["typecheck"]
    Trigger --> Test["test"]
    Build & Lint & Typecheck & Test -->|push to main only| Deploy["deploy\nSSH → EC2"]
```

All four jobs run in parallel. `deploy` triggers only on push to `main` after all checks pass.

---

## 8. Future Work

- [ADR-002: Scanner Deduplication Under Horizontal Scaling](adr/ADR-002-scanner-horizontal-scaling.md)
- [ADR-003: ELK Stack for Log Aggregation](adr/ADR-003-elk-stack-logging.md)
