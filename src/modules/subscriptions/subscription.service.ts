import crypto from 'node:crypto';
import type {
  Subscription,
  ISubscriptionService,
} from './subscription.types.js';
import {
  DuplicateSubscriptionError,
  InvalidTokenError,
  RepositoryNotFoundError,
  TokenNotFoundError,
} from './subscription.errors.js';
import { EMAIL_REQUESTED } from '@release-owl/contracts';
import type { EmailRequestedPayload } from '@release-owl/contracts';
import type { ISubscriptionModel } from './subscription.model.js';
import { subscriptionOperationsTotal } from '../../metrics/index.js';
import logger from '../../platform/logger.js';
import type { IOutboxModel } from '../outbox/index.js';
import type { IUnitOfWork } from '../../platform/db/unit-of-work.js';
import type { IGithubService } from '../github/index.js';
import { isValidToken } from './token.js';

const hashEmail = (email: string): string =>
  crypto.createHash('sha256').update(email).digest('hex').slice(0, 12);

export class SubscriptionService implements ISubscriptionService {
  constructor(
    private readonly subscriptionModel: ISubscriptionModel,
    private readonly outbox: IOutboxModel,
    private readonly githubService: IGithubService,
    private readonly unitOfWork: IUnitOfWork,
  ) {}

  async subscribe(email: string, repo: string): Promise<void> {
    const exists = await this.githubService.repositoryExists(repo);
    if (!exists) {
      subscriptionOperationsTotal.inc({
        operation: 'subscribe',
        result: 'repo_not_found',
      });
      throw new RepositoryNotFoundError(repo);
    }

    const alreadyConfirmed =
      await this.subscriptionModel.hasConfirmedSubscription(email, repo);
    if (alreadyConfirmed) {
      logger.warn(
        { event: 'subscription.duplicate', emailHash: hashEmail(email), repo },
        'Duplicate subscription attempt',
      );
      subscriptionOperationsTotal.inc({
        operation: 'subscribe',
        result: 'duplicate',
      });
      throw new DuplicateSubscriptionError(repo);
    }

    const confirmToken = crypto.randomBytes(32).toString('hex');
    const unsubscribeToken = crypto.randomBytes(32).toString('hex');

    const event: EmailRequestedPayload = {
      type: 'confirmation',
      event_id: crypto.randomUUID(),
      email,
      repo,
      confirm_token: confirmToken,
    };

    // Persist the subscription and the email-requested event in one transaction.
    // The event is only published (and the email only sent) by the outbox relay
    // *after* this row is durably committed, so the confirmation link can never
    // resolve before the record exists — and a broker outage cannot lose the email,
    // since the relay re-publishes any row still marked unpublished.
    await this.unitOfWork.run(async (trx) => {
      await this.subscriptionModel.create(
        email,
        repo,
        confirmToken,
        unsubscribeToken,
        trx,
      );
      await this.outbox.enqueue(EMAIL_REQUESTED, event, trx);
    });
    subscriptionOperationsTotal.inc({
      operation: 'subscribe',
      result: 'success',
    });
    logger.info(
      { event: 'subscription.created', emailHash: hashEmail(email), repo },
      'Subscription created',
    );
  }

  async confirm(token: string): Promise<void> {
    if (!isValidToken(token)) {
      subscriptionOperationsTotal.inc({
        operation: 'confirm',
        result: 'invalid_token',
      });
      throw new InvalidTokenError();
    }
    const sub = await this.subscriptionModel.confirm(token);
    if (!sub) {
      subscriptionOperationsTotal.inc({
        operation: 'confirm',
        result: 'not_found',
      });
      throw new TokenNotFoundError();
    }
    subscriptionOperationsTotal.inc({
      operation: 'confirm',
      result: 'success',
    });
    logger.info(
      {
        event: 'subscription.confirmed',
        emailHash: hashEmail(sub.email),
        repo: sub.repo,
      },
      'Subscription confirmed',
    );
  }

  async unsubscribe(token: string): Promise<void> {
    if (!isValidToken(token)) {
      subscriptionOperationsTotal.inc({
        operation: 'unsubscribe',
        result: 'invalid_token',
      });
      throw new InvalidTokenError();
    }
    const sub = await this.subscriptionModel.deleteByUnsubscribeToken(token);
    if (!sub) {
      subscriptionOperationsTotal.inc({
        operation: 'unsubscribe',
        result: 'not_found',
      });
      throw new TokenNotFoundError();
    }
    subscriptionOperationsTotal.inc({
      operation: 'unsubscribe',
      result: 'success',
    });
    logger.info(
      {
        event: 'subscription.unsubscribed',
        emailHash: hashEmail(sub.email),
        repo: sub.repo,
      },
      'Subscription unsubscribed',
    );
  }

  async getSubscriptions(email: string): Promise<Subscription[]> {
    return this.subscriptionModel.findByEmail(email);
  }
}
