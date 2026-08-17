import knex from './platform/db/knex.js';
import { config } from './platform/config/index.js';
import logger from './platform/logger.js';
import { RabbitMQBroker } from '@release-owl/platform';
import { GithubService, FetchHttpClient } from './modules/github/index.js';
import {
  BrokerNotifier,
  GrpcNotifier,
  RestNotifier,
  type Notifier,
} from './modules/notifications/index.js';
import { SubscriptionModel } from './modules/subscriptions/subscription.model.js';
import { RepositoryModel } from './modules/subscriptions/repository.model.js';
import { SubscriptionService } from './modules/subscriptions/subscription.service.js';
import { KnexUnitOfWork } from './platform/db/unit-of-work.js';
import { OutboxModel, OutboxRelay } from './modules/outbox/index.js';
import { SubscriptionController } from './modules/subscriptions/subscription.controller.js';
import {
  ScannerService,
  InProcessReleaseHandler,
} from './modules/releases/index.js';
import {
  SubscriptionSagaModel,
  SubscriptionSagaOrchestrator,
  SagaReplyConsumer,
  SagaSweeper,
} from './modules/sagas/index.js';

const githubService = new GithubService(
  new FetchHttpClient(),
  config.github.token,
);

export const broker = new RabbitMQBroker(config.rabbitmq.url, logger);

/**
 * Selects the Notifier implementation based on the NOTIFIER env var.
 *
 *   broker (default) — async RabbitMQ publish; drives the email Saga.
 *   rest             — synchronous HTTP POST /api/notify (hw7 baseline).
 *   grpc             — synchronous gRPC call to NotificationService.
 *
 * gRPC and REST both bypass the Saga; the broker path stays the default so
 * existing subscribe / release flows are unchanged.
 */
function createNotifier(): Notifier {
  switch (config.notification.notifier) {
    case 'rest':
      return new RestNotifier(
        {
          baseUrl: config.notification.restUrl,
          timeoutMs: config.notification.timeoutMs,
        },
        logger,
      );
    case 'grpc':
      return new GrpcNotifier(
        {
          grpcUrl: config.notification.grpcUrl,
          timeoutMs: config.notification.timeoutMs,
        },
        logger,
      );
    case 'broker':
    default:
      return new BrokerNotifier(broker);
  }
}

const notifier = createNotifier();

const repositoryModel = new RepositoryModel(knex);
const subscriptionModel = new SubscriptionModel(knex, repositoryModel);
const outboxModel = new OutboxModel(knex);
const unitOfWork = new KnexUnitOfWork(knex);

// Saga orchestrator: drives the subscribe→email-delivered distributed transaction.
const sagaModel = new SubscriptionSagaModel(knex);
const sagaOrchestrator = new SubscriptionSagaOrchestrator(
  sagaModel,
  subscriptionModel,
  unitOfWork,
  logger,
);
export const sagaReplyConsumer = new SagaReplyConsumer(
  broker,
  sagaOrchestrator,
  logger,
);
export const sagaSweeper = new SagaSweeper(
  sagaModel,
  sagaOrchestrator,
  logger,
  { intervalMs: config.saga.sweepIntervalMs, timeoutMs: config.saga.timeoutMs },
);

const subscriptionService = new SubscriptionService(
  subscriptionModel,
  outboxModel,
  githubService,
  unitOfWork,
  sagaModel,
);

export { subscriptionModel, repositoryModel };

// Publishes outbox events (e.g. confirmation emails) to the broker out-of-band,
// decoupling the subscribe request from broker availability.
export const outboxRelay = new OutboxRelay(
  outboxModel,
  broker,
  unitOfWork,
  logger,
  config.outbox,
);

export const subscriptionController = new SubscriptionController(
  subscriptionService,
);

const releaseHandler = new InProcessReleaseHandler(
  notifier,
  repositoryModel,
  logger,
);

export const scannerService = new ScannerService(
  subscriptionModel,
  githubService,
  releaseHandler,
  logger,
);
