import type { Notifier } from '../../notifications/index.js';
import type {
  IRepositoryModel,
  ConfirmedSubscriptionWithToken,
} from '../../subscriptions/index.js';
import type { Release } from '../../github/index.js';
import type { ILogger } from '../../../platform/logger.js';
import { InProcessReleaseHandler } from '../release.handler.js';

const REPO = 'owner/repo';
const RELEASE: Release = {
  tag_name: 'v2.0.0',
  html_url: 'https://github.com/owner/repo/releases/tag/v2.0.0',
};

function makeSubscriber(
  email: string,
  unsubscribeToken = 'token-' + email,
): ConfirmedSubscriptionWithToken {
  return {
    email,
    repo: REPO,
    unsubscribe_token: unsubscribeToken,
    last_seen_tag: 'v1.0.0',
  };
}

describe('InProcessReleaseHandler', () => {
  let handler: InProcessReleaseHandler;
  let mockNotifier: { [K in keyof Notifier]: jest.Mock };
  let mockRepositoryModel: { [K in keyof IRepositoryModel]: jest.Mock };
  let mockLogger: { [K in keyof ILogger]: jest.Mock };

  beforeEach(() => {
    mockNotifier = {
      sendConfirmationEmail: jest.fn(),
      sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
    };
    mockRepositoryModel = {
      upsert: jest.fn(),
      updateLastSeenTag: jest.fn().mockResolvedValue(undefined),
    };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };

    handler = new InProcessReleaseHandler(
      mockNotifier,
      mockRepositoryModel,
      mockLogger,
    );
  });

  it('should send a notification email to every subscriber', async () => {
    await handler.handle(REPO, RELEASE, [
      makeSubscriber('a@example.com', 'token-a'),
      makeSubscriber('b@example.com', 'token-b'),
    ]);

    expect(mockNotifier.sendNotificationEmail).toHaveBeenCalledTimes(2);
    expect(mockNotifier.sendNotificationEmail).toHaveBeenCalledWith(
      'a@example.com',
      REPO,
      'v2.0.0',
      'token-a',
    );
    expect(mockNotifier.sendNotificationEmail).toHaveBeenCalledWith(
      'b@example.com',
      REPO,
      'v2.0.0',
      'token-b',
    );
  });

  it('should update last_seen_tag after all notifications succeed', async () => {
    await handler.handle(REPO, RELEASE, [makeSubscriber('a@example.com')]);

    expect(mockRepositoryModel.updateLastSeenTag).toHaveBeenCalledWith(
      REPO,
      'v2.0.0',
    );
  });

  it('should update last_seen_tag even if some notifications fail', async () => {
    mockNotifier.sendNotificationEmail
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('SMTP error'));

    await handler.handle(REPO, RELEASE, [
      makeSubscriber('a@example.com'),
      makeSubscriber('b@example.com'),
    ]);

    expect(mockRepositoryModel.updateLastSeenTag).toHaveBeenCalledWith(
      REPO,
      'v2.0.0',
    );
  });

  it('should log an error for each failed notification without blocking others', async () => {
    mockNotifier.sendNotificationEmail
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce(undefined);

    await handler.handle(REPO, RELEASE, [
      makeSubscriber('a@example.com'),
      makeSubscriber('b@example.com'),
    ]);

    expect(mockLogger.error).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ repo: REPO }),
      'ReleaseHandler: failed to send notification email',
    );
  });

  it('should attempt delivery to all subscribers even if one fails', async () => {
    mockNotifier.sendNotificationEmail
      .mockRejectedValueOnce(new Error('SMTP error'))
      .mockResolvedValueOnce(undefined);

    await handler.handle(REPO, RELEASE, [
      makeSubscriber('a@example.com'),
      makeSubscriber('b@example.com'),
    ]);

    expect(mockNotifier.sendNotificationEmail).toHaveBeenCalledTimes(2);
  });
});
