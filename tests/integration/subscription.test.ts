import request from 'supertest';
import app from '../../src/app.js';
import knex from '../../src/platform/db/knex.js';
import { GithubService } from '../../src/modules/github/github.service.js';
import { BrokerNotifier } from '../../src/modules/notifications/broker-notifier.js';
import { subscriptionModel, repositoryModel } from '../../src/container.js';

jest.mock('../../src/modules/github/github.service.js');
jest.mock('../../src/modules/notifications/broker-notifier.js');

const mockedGithub = jest.mocked(GithubService).prototype;
const mockedEmail = jest.mocked(BrokerNotifier).prototype;

const EMAIL = 'integration@example.com';
const REPO = 'owner/repo';
const API_KEY =
  process.env.API_KEY ??
  (() => {
    throw new Error(
      'API_KEY environment variable is required for integration tests',
    );
  })();

async function subscribe(email = EMAIL, repo = REPO) {
  return request(app)
    .post('/api/subscribe')
    .set('X-API-Key', API_KEY)
    .send({ email, repo });
}

async function getTokens(email = EMAIL, repo = REPO) {
  const row = await knex('subscriptions')
    .where({ email, repo })
    .select('confirm_token', 'unsubscribe_token')
    .first();
  expect(row).toBeDefined();
  return {
    confirmToken: row.confirm_token as string,
    unsubscribeToken: row.unsubscribe_token as string,
  };
}

beforeEach(async () => {
  await knex('outbox').delete();
  await knex('subscriptions').delete();
  await knex('repositories').delete();
  jest.clearAllMocks();
  mockedGithub.repositoryExists.mockResolvedValue(true);
  mockedEmail.sendConfirmationEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  await knex.destroy();
});

// ---------------------------------------------------------------------------

describe('API key authentication', () => {
  it('returns 401 when X-API-Key header is missing', async () => {
    const res = await request(app).post('/api/subscribe').send({});

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when X-API-Key header is invalid', async () => {
    const res = await request(app)
      .post('/api/subscribe')
      .set('X-API-Key', 'wrong-key')
      .send({});

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------

describe('POST /api/subscribe', () => {
  it('returns 200, persists a pending subscription, and enqueues a confirmation event', async () => {
    const res = await subscribe();

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');

    const sub = await knex('subscriptions')
      .where({ email: EMAIL, repo: REPO })
      .first();
    expect(sub).toMatchObject({ email: EMAIL, repo: REPO, status: 'pending' });

    // The email is not sent inline; an outbox row is committed in the same
    // transaction and published to the broker later by the relay.
    const events = await knex('outbox').where({
      routing_key: 'email.requested',
    });
    expect(events).toHaveLength(1);
    expect(events[0].published_at).toBeNull();
    expect(events[0].payload).toMatchObject({
      type: 'confirmation',
      email: EMAIL,
      repo: REPO,
      confirm_token: sub.confirm_token,
    });
  });

  it('does not fail when the same repo is used for a different email', async () => {
    await subscribe(EMAIL, REPO);

    const res = await subscribe('other@example.com', REPO);

    expect(res.status).toBe(200);
    const count = await knex('repositories')
      .where({ repo: REPO })
      .count('* as n')
      .first();
    expect(Number(count?.n)).toBe(1); // upsert — still one repo row
  });

  it('returns 400 for invalid email format', async () => {
    const res = await subscribe('not-an-email', REPO);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for invalid repo format', async () => {
    const res = await subscribe(EMAIL, 'no-slash');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when repository does not exist on GitHub', async () => {
    mockedGithub.repositoryExists.mockResolvedValue(false);

    const res = await subscribe();

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('resends the confirmation and keeps one row when re-subscribing while pending', async () => {
    await subscribe();
    const res = await subscribe();

    expect(res.status).toBe(200);

    const events = await knex('outbox').where({
      routing_key: 'email.requested',
    });
    expect(events).toHaveLength(2);

    const rows = await knex('subscriptions').where({
      email: EMAIL,
      repo: REPO,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
  });

  it('returns 409 and keeps one row when re-subscribing to a confirmed subscription', async () => {
    await subscribe();
    const { confirmToken } = await getTokens();
    await request(app).get(`/api/confirm/${confirmToken}`);

    const res = await subscribe();

    expect(res.status).toBe(409);
    expect(res.body).toHaveProperty('error');

    const count = await knex('subscriptions')
      .where({ email: EMAIL, repo: REPO })
      .count('* as n')
      .first();
    expect(Number(count?.n)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('GET /api/confirm/:token', () => {
  beforeEach(async () => {
    await subscribe();
  });

  it('returns 200 and marks subscription as confirmed in DB', async () => {
    const { confirmToken } = await getTokens();

    const res = await request(app).get(`/api/confirm/${confirmToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');

    const sub = await knex('subscriptions')
      .where({ confirm_token: confirmToken })
      .first();
    expect(sub.status).toBe('confirmed');
  });

  it('returns 400 for invalid token format', async () => {
    const res = await request(app).get('/api/confirm/invalid-token');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(app).get(`/api/confirm/${'a'.repeat(64)}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------

describe('GET /api/unsubscribe/:token', () => {
  beforeEach(async () => {
    await subscribe();
  });

  it('returns 200 and removes the subscription from DB', async () => {
    const { unsubscribeToken } = await getTokens();

    const res = await request(app).get(`/api/unsubscribe/${unsubscribeToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('message');

    const sub = await knex('subscriptions')
      .where({ unsubscribe_token: unsubscribeToken })
      .first();
    expect(sub).toBeUndefined();
  });

  it('returns 400 for invalid token format', async () => {
    const res = await request(app).get('/api/unsubscribe/bad-token');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 for unknown token', async () => {
    const res = await request(app).get(`/api/unsubscribe/${'b'.repeat(64)}`);

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------

describe('GET /api/subscriptions', () => {
  it('returns confirmed subscriptions for the given email', async () => {
    await subscribe();
    const { confirmToken } = await getTokens();
    await request(app).get(`/api/confirm/${confirmToken}`);

    const res = await request(app)
      .get('/api/subscriptions')
      .query({ email: EMAIL });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      email: EMAIL,
      repo: REPO,
      confirmed: true,
    });
  });

  it('returns empty array when subscription is still pending', async () => {
    await subscribe(); // pending — not yet confirmed

    const res = await request(app)
      .get('/api/subscriptions')
      .query({ email: EMAIL });

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('returns empty array for unknown email', async () => {
    const res = await request(app)
      .get('/api/subscriptions')
      .query({ email: 'nobody@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 400 when email query param is missing', async () => {
    const res = await request(app).get('/api/subscriptions');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for invalid email format', async () => {
    const res = await request(app)
      .get('/api/subscriptions')
      .query({ email: 'not-valid' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// Scanner methods — not exposed via HTTP, tested directly against the DB

describe('subscriptionModel - scanner methods', () => {
  describe('findAllConfirmedWithTokens()', () => {
    it('returns confirmed subscriptions with unsubscribe token', async () => {
      await subscribe();
      const { confirmToken, unsubscribeToken } = await getTokens();
      await request(app).get(`/api/confirm/${confirmToken}`);

      const result = await subscriptionModel.findAllConfirmedWithTokens();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        email: EMAIL,
        repo: REPO,
        unsubscribe_token: unsubscribeToken,
        last_seen_tag: null,
      });
    });

    it('does not return pending subscriptions', async () => {
      await subscribe();

      const result = await subscriptionModel.findAllConfirmedWithTokens();

      expect(result).toHaveLength(0);
    });
  });

  describe('updateLastSeenTag()', () => {
    it('updates last_seen_tag for the repository', async () => {
      await subscribe();

      await repositoryModel.updateLastSeenTag(REPO, 'v3.0.0');

      const repo = await knex('repositories').where({ repo: REPO }).first();
      expect(repo.last_seen_tag).toBe('v3.0.0');
    });
  });
});
