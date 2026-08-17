import { RabbitMQBroker } from '@release-owl/platform';
import { config } from './config.js';
import logger from './logger.js';
import { NodemailerEmailSender } from './email.sender.js';
import { RetryingEmailSender } from './retrying-email.sender.js';
import { EmailTemplateBuilder } from './email-template.builder.js';
import { EmailService } from './email.service.js';
import { EmailRequestedConsumer } from './email-requested.consumer.js';
import knex from './db/knex.js';
import { KnexUnitOfWork } from './db/unit-of-work.js';
import { OutboxModel } from './outbox/outbox.model.js';
import { OutboxRelay } from './outbox/outbox.relay.js';
import { InboxModel } from './inbox/inbox.model.js';

export const broker = new RabbitMQBroker(config.rabbitmq.url, logger);

const smtpSender = new NodemailerEmailSender({
  host: config.email.host,
  port: config.email.port,
  user: config.email.user,
  pass: config.email.pass,
  from: config.email.from,
});

const emailSender = new RetryingEmailSender(
  smtpSender,
  { attempts: config.retry.attempts, backoffMs: config.retry.backoffMs },
  logger,
);

const emailTemplates = new EmailTemplateBuilder(config.app.baseUrl);
const notifier = new EmailService(emailSender, emailTemplates);

const uow = new KnexUnitOfWork(knex);
const outboxModel = new OutboxModel(knex);
const inboxModel = new InboxModel(knex);

export const outboxRelay = new OutboxRelay(
  outboxModel,
  broker,
  uow,
  logger,
  config.outbox,
);

export const emailRequestedConsumer = new EmailRequestedConsumer(
  broker,
  notifier,
  logger,
  inboxModel,
  outboxModel,
  uow,
);

// Exported so index.ts can call knex.destroy() during graceful shutdown.
export { knex };
