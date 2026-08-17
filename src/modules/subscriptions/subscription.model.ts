import type { Knex } from 'knex';
import type {
  Subscription,
  ConfirmedSubscriptionWithToken,
} from './subscription.types.js';
import type { IRepositoryModel } from './repository.model.js';

interface SubscriptionRow {
  email: string;
  repo: string;
  last_seen_tag: string | null;
}

export interface ISubscriptionModel {
  create(
    email: string,
    repo: string,
    confirmToken: string,
    unsubscribeToken: string,
    trx?: Knex,
  ): Promise<void>;
  hasConfirmedSubscription(email: string, repo: string): Promise<boolean>;
  confirm(
    confirmToken: string,
  ): Promise<{ email: string; repo: string } | null>;
  deleteByUnsubscribeToken(
    unsubscribeToken: string,
  ): Promise<{ email: string; repo: string } | null>;
  findAllConfirmedWithTokens(): Promise<ConfirmedSubscriptionWithToken[]>;
  findByEmail(email: string): Promise<Subscription[]>;
}

export class SubscriptionModel implements ISubscriptionModel {
  constructor(
    private readonly db: Knex,
    private readonly repositoryModel: IRepositoryModel,
  ) {}

  // Ensures the repository exists, then inserts a new pending subscription with both
  // tokens. Accepts a transaction so the insert can be committed atomically with the
  // outbox event that triggers the confirmation email.
  async create(
    email: string,
    repo: string,
    confirmToken: string,
    unsubscribeToken: string,
    trx?: Knex,
  ): Promise<void> {
    await this.repositoryModel.upsert(repo, trx);
    await (trx ?? this.db)('subscriptions')
      .insert({
        email,
        repo,
        confirm_token: confirmToken,
        unsubscribe_token: unsubscribeToken,
        status: 'pending',
      })
      .onConflict(['email', 'repo'])
      .merge(['confirm_token', 'unsubscribe_token']);
  }

  // Returns true only when a CONFIRMED subscription exists. A still-pending row is
  // not treated as a duplicate, so re-subscribing resends the confirmation email.
  async hasConfirmedSubscription(
    email: string,
    repo: string,
  ): Promise<boolean> {
    const row: unknown = await this.db('subscriptions')
      .where({ email, repo, status: 'confirmed' })
      .first();
    return row !== undefined;
  }

  // Sets subscription status to confirmed. Returns the subscription row, or null if token not found.
  async confirm(
    confirmToken: string,
  ): Promise<{ email: string; repo: string } | null> {
    const rows: { email: string; repo: string }[] = await this.db(
      'subscriptions',
    )
      .where({ confirm_token: confirmToken })
      .update({ status: 'confirmed' })
      .returning(['email', 'repo']);
    return rows[0] ?? null;
  }

  // Deletes the subscription by its unsubscribe token. Returns the subscription row, or null if not found.
  async deleteByUnsubscribeToken(
    unsubscribeToken: string,
  ): Promise<{ email: string; repo: string } | null> {
    const rows: { email: string; repo: string }[] = await this.db(
      'subscriptions',
    )
      .where({ unsubscribe_token: unsubscribeToken })
      .delete()
      .returning(['email', 'repo']);
    return rows[0] ?? null;
  }

  // Returns all confirmed subscriptions with their unsubscribe tokens and last seen tag.
  async findAllConfirmedWithTokens(): Promise<
    ConfirmedSubscriptionWithToken[]
  > {
    return this.db('subscriptions')
      .join('repositories', 'subscriptions.repo', 'repositories.repo')
      .where('subscriptions.status', 'confirmed')
      .select(
        'subscriptions.email',
        'subscriptions.repo',
        'subscriptions.unsubscribe_token',
        'repositories.last_seen_tag',
      );
  }

  // Returns all confirmed subscriptions for the given email, including last seen release tag.
  async findByEmail(email: string): Promise<Subscription[]> {
    const rows: SubscriptionRow[] = await this.db('subscriptions')
      .join('repositories', 'subscriptions.repo', 'repositories.repo')
      .where({
        'subscriptions.email': email,
        'subscriptions.status': 'confirmed',
      })
      .select(
        'subscriptions.email',
        'subscriptions.repo',
        'repositories.last_seen_tag',
      );

    return rows.map((row) => ({
      email: row.email,
      repo: row.repo,
      confirmed: true,
      last_seen_tag: row.last_seen_tag,
    }));
  }
}
