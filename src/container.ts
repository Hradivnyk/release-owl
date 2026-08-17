import knex from './platform/db/knex.js';
import { config } from './platform/config/index.js';
import logger from './platform/logger.js';
import { RabbitMQBroker } from '@release-owl/platform';
import { GithubService, FetchHttpClient } from './modules/github/index.js';
import { BrokerNotifier } from './modules/notifications/index.js';
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

const githubService = new GithubService(
  new FetchHttpClient(),
  config.github.token,
);

export const broker = new RabbitMQBroker(config.rabbitmq.url, logger);

const notifier = new BrokerNotifier(broker);

const repositoryModel = new RepositoryModel(knex);
const subscriptionModel = new SubscriptionModel(knex, repositoryModel);
const outboxModel = new OutboxModel(knex);
const unitOfWork = new KnexUnitOfWork(knex);

const subscriptionService = new SubscriptionService(
  subscriptionModel,
  outboxModel,
  githubService,
  unitOfWork,
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
