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
import type { ISagaModel } from '../sagas/index.js';
import { isValidToken } from './token.js';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    err.code === '23505'
  );
}

const hashEmail = (email: string): string =>
  crypto.createHash('sha256').update(email).digest('hex').slice(0, 12);

export class SubscriptionService implements ISubscriptionService {
  constructor(
    private readonly subscriptionModel: ISubscriptionModel,
    private readonly outbox: IOutboxModel,
    private readonly githubService: IGithubService,
    private readonly unitOfWork: IUnitOfWork,
    private readonly sagaModel: ISagaModel,
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

    // Persist the subscription, start the saga, and enqueue the email command in
    // one atomic transaction. The outbox relay publishes the command only after
    // the transaction commits, so the notification service always finds a valid
    // saga row when it replies. saga_id flows through the email.requested command
    // and back in the email.sent / email.failed reply so the orchestrator can match.
    await this.unitOfWork.run(async (trx) => {
      // Try updating an existing pending row first (re-subscribe while pending).
      // Falls back to insert if no pending row exists yet.
      let subscriptionId =
        await this.subscriptionModel.updatePendingSubscription(
          email,
          repo,
          confirmToken,
          unsubscribeToken,
          trx,
        );
      if (subscriptionId === null) {
        try {
          subscriptionId = await this.subscriptionModel.create(
            email,
            repo,
            confirmToken,
            unsubscribeToken,
            trx,
          );
        } catch (err: unknown) {
          if (isUniqueViolation(err))
            throw new DuplicateSubscriptionError(repo);
          throw err;
        }
      }
      const sagaId = await this.sagaModel.start(subscriptionId, trx);

      const event: EmailRequestedPayload = {
        type: 'confirmation',
        event_id: crypto.randomUUID(),
        email,
        repo,
        confirm_token: confirmToken,
        saga_id: sagaId,
      };
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
