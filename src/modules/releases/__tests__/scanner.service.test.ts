import type {
  ConfirmedSubscriptionsProvider,
  ConfirmedSubscriptionWithToken,
} from '../../subscriptions/index.js';
import type { IGithubService } from '../../github/index.js';
import type { ReleaseHandler } from '../release.handler.js';
import type { ILogger } from '../../../platform/logger.js';
import { ScannerService } from '../scanner.service.js';

const REPO_A = 'owner/repo-a';
const REPO_B = 'owner/repo-b';

function makeSubscriber(
  repo: string,
  email: string,
  lastSeenTag: string | null = null,
  unsubscribeToken = 'token-' + email,
): ConfirmedSubscriptionWithToken {
  return {
    email,
    repo,
    unsubscribe_token: unsubscribeToken,
    last_seen_tag: lastSeenTag,
  };
}

describe('ScannerService', () => {
  let service: ScannerService;

  let mockSubs: { [K in keyof ConfirmedSubscriptionsProvider]: jest.Mock };
  let mockGithub: { [K in keyof IGithubService]: jest.Mock };
  let mockReleaseHandler: { [K in keyof ReleaseHandler]: jest.Mock };
  let mockLogger: { [K in keyof ILogger]: jest.Mock };

  beforeEach(() => {
    mockSubs = { findAllConfirmedWithTokens: jest.fn() };
    mockGithub = { repositoryExists: jest.fn(), getLatestRelease: jest.fn() };
    mockReleaseHandler = { handle: jest.fn().mockResolvedValue(undefined) };
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
    };

    service = new ScannerService(
      mockSubs,
      mockGithub,
      mockReleaseHandler,
      mockLogger,
    );
  });

  describe('scan', () => {
    it('should not check GitHub or handle releases when there are no active subscriptions', async () => {
      mockSubs.findAllConfirmedWithTokens.mockResolvedValue([]);

      await service.scan();

      expect(mockGithub.getLatestRelease).not.toHaveBeenCalled();
      expect(mockReleaseHandler.handle).not.toHaveBeenCalled();
    });

    it('should fetch the latest release for each unique repository in active subscriptions', async () => {
      mockSubs.findAllConfirmedWithTokens.mockResolvedValue([
        makeSubscriber(REPO_A, 'a@example.com', 'v1.0.0'),
        makeSubscriber(REPO_A, 'b@example.com', 'v1.0.0'),
        makeSubscriber(REPO_B, 'c@example.com', 'v2.0.0'),
      ]);
      mockGithub.getLatestRelease.mockResolvedValue({
        tag_name: 'v1.0.0',
        html_url: 'https://github.com',
      });

      await service.scan();

      expect(mockGithub.getLatestRelease).toHaveBeenCalledTimes(2);
      expect(mockGithub.getLatestRelease).toHaveBeenCalledWith(REPO_A);
      expect(mockGithub.getLatestRelease).toHaveBeenCalledWith(REPO_B);
    });

    it('should delegate to the release handler with subscribers when a new release is detected', async () => {
      const subscribers = [
        makeSubscriber(REPO_A, 'a@example.com', 'v1.0.0', 'token-a'),
        makeSubscriber(REPO_A, 'b@example.com', 'v1.0.0', 'token-b'),
      ];
      mockSubs.findAllConfirmedWithTokens.mockResolvedValue(subscribers);
      const release = { tag_name: 'v2.0.0', html_url: 'https://github.com' };
      mockGithub.getLatestRelease.mockResolvedValue(release);

      await service.scan();

      expect(mockReleaseHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockReleaseHandler.handle).toHaveBeenCalledWith(
        REPO_A,
        release,
        subscribers,
      );
    });

    it('should not handle a release if the latest release matches last_seen_tag', async () => {
      mockSubs.findAllConfirmedWithTokens.mockResolvedValue([
        makeSubscriber(REPO_A, 'a@example.com', 'v1.0.0'),
      ]);
      mockGithub.getLatestRelease.mockResolvedValue({
        tag_name: 'v1.0.0',
        html_url: 'https://github.com',
      });

      await service.scan();

      expect(mockReleaseHandler.handle).not.toHaveBeenCalled();
    });

    it('should not handle a release if the repository has no releases', async () => {
      mockSubs.findAllConfirmedWithTokens.mockResolvedValue([
        makeSubscriber(REPO_A, 'a@example.com', null),
      ]);
      mockGithub.getLatestRelease.mockResolvedValue(null);

      await service.scan();

      expect(mockReleaseHandler.handle).not.toHaveBeenCalled();
    });

    it('should continue processing remaining repos if one GitHub API call fails', async () => {
      mockSubs.findAllConfirmedWithTokens.mockResolvedValue([
        makeSubscriber(REPO_A, 'a@example.com', 'v1.0.0'),
        makeSubscriber(REPO_B, 'b@example.com', 'v1.0.0'),
      ]);
      const release = { tag_name: 'v2.0.0', html_url: 'https://github.com' };
      mockGithub.getLatestRelease
        .mockRejectedValueOnce(new Error('GitHub API error'))
        .mockResolvedValueOnce(release);

      await service.scan();

      expect(mockGithub.getLatestRelease).toHaveBeenCalledTimes(2);
      expect(mockReleaseHandler.handle).toHaveBeenCalledTimes(1);
      expect(mockReleaseHandler.handle).toHaveBeenCalledWith(
        REPO_B,
        release,
        expect.any(Array),
      );
    });
  });
});
