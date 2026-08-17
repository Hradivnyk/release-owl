import supertest from 'supertest';
import { createRestApp } from '../http/app.js';
import type { Notifier } from '../email.service.js';
import type { ILogger } from '../logger.js';

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function makeNotifier(override?: Partial<Notifier>): Notifier {
  return {
    sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
    ...override,
  };
}

describe('REST /api/notify', () => {
  it('returns 202 for a valid notification payload', async () => {
    const notifier = makeNotifier();
    const app = createRestApp(notifier, noopLogger);

    const res = await supertest(app).post('/api/notify').send({
      type: 'notification',
      email: 'a@b.com',
      repo: 'owner/repo',
      tag_name: 'v1.0.0',
      unsubscribe_token: 'tok123',
    });

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ status: 'sent' });
    expect(notifier.sendNotificationEmail).toHaveBeenCalledWith(
      'a@b.com',
      'owner/repo',
      'v1.0.0',
      'tok123',
    );
  });

  it('returns 202 for a valid confirmation payload', async () => {
    const notifier = makeNotifier();
    const app = createRestApp(notifier, noopLogger);

    const res = await supertest(app).post('/api/notify').send({
      type: 'confirmation',
      email: 'a@b.com',
      repo: 'owner/repo',
      confirm_token: 'ct123',
    });

    expect(res.status).toBe(202);
    expect(notifier.sendConfirmationEmail).toHaveBeenCalledWith(
      'a@b.com',
      'ct123',
      'owner/repo',
    );
  });

  it('returns 400 for an invalid payload (missing fields)', async () => {
    const app = createRestApp(makeNotifier(), noopLogger);

    const res = await supertest(app)
      .post('/api/notify')
      .send({ type: 'notification', email: 'bad-email' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'invalid_request' });
  });

  it('returns 400 for an unknown type', async () => {
    const app = createRestApp(makeNotifier(), noopLogger);

    const res = await supertest(app)
      .post('/api/notify')
      .send({ type: 'unknown', email: 'a@b.com' });

    expect(res.status).toBe(400);
  });

  it('returns 502 when the notifier throws', async () => {
    const failingNotifier = makeNotifier({
      sendNotificationEmail: jest
        .fn()
        .mockRejectedValue(new Error('smtp down')),
    });
    const app = createRestApp(failingNotifier, noopLogger);

    const res = await supertest(app).post('/api/notify').send({
      type: 'notification',
      email: 'a@b.com',
      repo: 'owner/repo',
      tag_name: 'v1',
      unsubscribe_token: 'tok',
    });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ error: 'email_send_failed' });
  });

  it('GET /health returns 200 ok', async () => {
    const app = createRestApp(makeNotifier(), noopLogger);
    const res = await supertest(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
