export interface Subscription {
  email: string;
  repo: string;
  confirmed: boolean;
  last_seen_tag: string | null;
}

export interface ConfirmedSubscriptionWithToken {
  email: string;
  repo: string;
  unsubscribe_token: string;
  last_seen_tag: string | null;
}

export interface ISubscriptionService {
  subscribe(email: string, repo: string): Promise<void>;
  confirm(token: string): Promise<void>;
  unsubscribe(token: string): Promise<void>;
  getSubscriptions(email: string): Promise<Subscription[]>;
}

/** Port consumed by the releases module (scanner) to read confirmed subscriptions. */
export interface ConfirmedSubscriptionsProvider {
  findAllConfirmedWithTokens(): Promise<ConfirmedSubscriptionWithToken[]>;
}
