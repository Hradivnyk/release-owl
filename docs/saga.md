# Orchestrated Saga: subscribe → email delivered

## Overview

The subscribe flow is a distributed transaction across two services:

- **`app`** — orchestrator. Creates the pending subscription and saga state atomically, then waits for a reply.
- **`notification`** — participant. Sends the confirmation email and publishes either `email.sent` or `email.failed`.

**The saga terminates on "email sent."** Clicking the confirmation link is a separate, later step outside the saga.

**Compensation:** if the email cannot be delivered after all retries, `notification` publishes `email.failed` → `app` **deletes the pending subscription** and marks the saga `compensated`. This restores the pre-saga state and frees the `(email, repo)` unique slot so the user can re-subscribe.

---

## Happy Path

```mermaid
sequenceDiagram
    participant Client
    participant Express
    participant SubscriptionService
    participant GitHubAPI as GitHub API
    participant AppDB as App DB
    participant OutboxRelay as App OutboxRelay
    participant RabbitMQ
    participant NotificationService
    participant NotifDB as Notification DB
    participant NotifRelay as Notification OutboxRelay
    participant SMTP
    participant Orchestrator as SagaOrchestrator

    Client->>Express: POST /subscribe
    Express->>SubscriptionService: subscribe(email, repo)
    SubscriptionService->>GitHubAPI: GET /repos/{repo}
    GitHubAPI-->>SubscriptionService: 200 OK
    SubscriptionService->>AppDB: INSERT subscription + saga_row + outbox event (atomic)
    Express-->>Client: 200 OK

    Note over OutboxRelay: polls every 1 s
    OutboxRelay->>AppDB: SELECT unpublished (FOR UPDATE SKIP LOCKED)
    OutboxRelay->>RabbitMQ: publish email.requested {saga_id}
    OutboxRelay->>AppDB: mark published
    RabbitMQ-->>NotificationService: email.requested {saga_id}

    NotificationService->>NotifDB: inbox.wasProcessed(saga_id)?
    NotifDB-->>NotificationService: false
    NotificationService->>SMTP: sendConfirmationEmail
    SMTP-->>NotificationService: sent
    NotificationService->>NotifDB: INSERT inbox{sent} + outbox{email.sent} (atomic)

    Note over NotifRelay: polls every 1 s
    NotifRelay->>NotifDB: SELECT unpublished
    NotifRelay->>RabbitMQ: publish email.sent {saga_id}
    NotifRelay->>NotifDB: mark published
    RabbitMQ-->>Orchestrator: email.sent {saga_id}
    Orchestrator->>AppDB: UPDATE saga status=completed

    Client->>Express: GET /confirm/:token
    Express->>SubscriptionService: confirm(token)
    SubscriptionService->>AppDB: UPDATE status=confirmed
    Express-->>Client: 200 OK
```

---

## Compensation Path (email permanently failed)

```mermaid
sequenceDiagram
    participant NotificationService
    participant NotifDB as Notification DB
    participant SMTP
    participant RabbitMQ
    participant Orchestrator as SagaOrchestrator
    participant AppDB as App DB

    Note over NotificationService: retries exhausted after N attempts
    NotificationService->>SMTP: sendConfirmationEmail (attempt N)
    SMTP-->>NotificationService: Error
    NotificationService->>NotifDB: INSERT inbox{failed} + outbox{email.failed} (atomic)

    NotifDB-->>RabbitMQ: email.failed {saga_id, reason} (via outbox relay)
    RabbitMQ-->>Orchestrator: email.failed {saga_id}
    Orchestrator->>AppDB: DELETE subscription + UPDATE saga status=compensated (atomic)
    Note over AppDB: Pending subscription removed. User can re-subscribe.
```

---

## App: Orchestrator Components

| Component                      | File                                                  | Role                                                                                              |
| ------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `SubscriptionSagaModel`        | `src/modules/sagas/subscription-saga.model.ts`        | CRUD на таблиці `subscription_sagas`                                                              |
| `SubscriptionSagaOrchestrator` | `src/modules/sagas/subscription-saga.orchestrator.ts` | `onEmailSent` → `completed`; `onEmailFailed` → delete subscription + `compensated`                |
| `SagaReplyConsumer`            | `src/modules/sagas/saga-reply.consumer.ts`            | Підписується на `email.sent` (queue `app.email-sent`) і `email.failed` (queue `app.email-failed`) |

**Атомарна стартова транзакція** (`SubscriptionService.subscribe`):

```sql
BEGIN
  INSERT subscriptions          → повертає subscription_id
  INSERT subscription_sagas     → повертає saga_id (correlation id)
  INSERT outbox { email.requested, saga_id }
COMMIT
```

**Idempotency:** orchestrator перевіряє `saga.status` перед кожною дією. Якщо сага вже в термінальному стані (`completed` або `compensated`) — хендлер є no-op. Безпечно при at-least-once redelivery.

---

## Notification: Participant Flow

Файл: `services/notification/src/email-requested.consumer.ts`

Тільки `type: 'confirmation'` бере участь у сазі. `type: 'notification'` (release emails) — fire-and-forget без змін.

```text
1. inbox.wasProcessed(saga_id)?  →  так: ack, return (ідемпотентно)
2. sendConfirmationEmail()       →  RetryingEmailSender (N спроб з backoff)
3a. Успіх:
      BEGIN
        INSERT inbox { saga_id, status='sent' }
        INSERT outbox { email.sent, saga_id }
      COMMIT → ack
3b. Вичерпано ретраї:
      BEGIN
        INSERT inbox { saga_id, status='failed' }
        INSERT outbox { email.failed, saga_id, reason }
      COMMIT → ack  (не nack — провал повідомлено через outbox)
```

**Inbox PK constraint** є останньою лінією захисту від дублікатів: якщо два паралельні delivery пройдуть pre-check одночасно, лише один вставить рядок — інший отримає PK violation → nack → redelivery → побачить `wasProcessed=true` → ack.
