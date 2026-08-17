import {
  DuplicateSubscriptionError,
  InvalidTokenError,
  RepositoryNotFoundError,
  TokenNotFoundError,
} from '../subscription.errors.js';
import type { Knex } from 'knex';
import { EMAIL_REQUESTED } from '@release-owl/contracts';
import type { ISubscriptionModel } from '../subscription.model.js';
import type { IOutboxModel } from '../../outbox/index.js';
import type { IGithubService } from '../../github/index.js';
import { SubscriptionService } from '../subscription.service.js';

const VALID_TOKEN = 'a'.repeat(64);
const EMAIL = 'user@example.com';
const REPO = 'owner/repo';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let mockModel: jest.Mocked<ISubscriptionModel>;
  let mockOutbox: jest.Mocked<IOutboxModel>;
  let mockUow: { run: jest.Mock };
  let mockGithubService: jest.Mocked<IGithubService>;

  beforeEach(() => {
    mockModel = {
      create: jest.fn(),
      hasConfirmedSubscription: jest.fn(),
      confirm: jest.fn(),
      deleteByUnsubscribeToken: jest.fn(),
      findAllConfirmedWithTokens: jest.fn(),
      findByEmail: jest.fn(),
    };
    mockOutbox = {
      enqueue: jest.fn(),
      claimUnpublished: jest.fn(),
      markPublished: jest.fn(),
    };
    // Runs the unit of work inline against a throwaway transaction stub.
    mockUow = {
      run: jest.fn(async (work: (trx: Knex.Transaction) => Promise<unknown>) =>
        work({} as Knex.Transaction),
      ),
    };
    mockGithubService = {
      repositoryExists: jest.fn(),
      getLatestRelease: jest.fn(),
    };
    service = new SubscriptionService(
      mockModel,
      mockOutbox,
      mockGithubService,
      mockUow,
    );
  });

  describe('subscribe', () => {
    beforeEach(() => {
      mockGithubService.repositoryExists.mockResolvedValue(true);
      mockModel.hasConfirmedSubscription.mockResolvedValue(false);
      mockModel.create.mockResolvedValue(undefined);
      mockOutbox.enqueue.mockResolvedValue(undefined);
    });

    it('should validate that the repository exists via githubService', async () => {
      await service.subscribe(EMAIL, REPO);

      expect(mockGithubService.repositoryExists).toHaveBeenCalledWith(REPO);
    });

    it('should save a new unconfirmed subscription to the database', async () => {
      await service.subscribe(EMAIL, REPO);

      expect(mockModel.create).toHaveBeenCalledWith(
        EMAIL,
        REPO,
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.anything(),
      );
    });

    it('should generate a confirmation token and store it', async () => {
      await service.subscribe(EMAIL, REPO);

      const [, , confirmToken, unsubscribeToken] =
        mockModel.create.mock.calls[0];
      expect(confirmToken).toMatch(/^[0-9a-f]{64}$/);
      expect(unsubscribeToken).toMatch(/^[0-9a-f]{64}$/);
      expect(confirmToken).not.toBe(unsubscribeToken);
    });

    it('should enqueue an email.requested event for the confirmation email', async () => {
      await service.subscribe(EMAIL, REPO);

      const [, , confirmToken] = mockModel.create.mock.calls[0];
      expect(mockOutbox.enqueue).toHaveBeenCalledWith(
        EMAIL_REQUESTED,
        {
          type: 'confirmation',
          event_id: expect.any(String),
          email: EMAIL,
          repo: REPO,
          confirm_token: confirmToken,
        },
        expect.anything(),
      );
    });

    it('should write the subscription and the event in a single unit of work', async () => {
      await service.subscribe(EMAIL, REPO);

      expect(mockUow.run).toHaveBeenCalledTimes(1);
      expect(mockModel.create).toHaveBeenCalledTimes(1);
      expect(mockOutbox.enqueue).toHaveBeenCalledTimes(1);
    });

    it('should throw RepositoryNotFoundError if githubService returns not found', async () => {
      mockGithubService.repositoryExists.mockResolvedValue(false);

      await expect(service.subscribe(EMAIL, REPO)).rejects.toThrow(
        RepositoryNotFoundError,
      );
    });

    it('should throw DuplicateSubscriptionError if a confirmed subscription already exists for email and repo', async () => {
      mockModel.hasConfirmedSubscription.mockResolvedValue(true);

      await expect(service.subscribe(EMAIL, REPO)).rejects.toThrow(
        DuplicateSubscriptionError,
      );
    });
  });

  describe('confirm', () => {
    it('should mark the subscription as confirmed in the database', async () => {
      mockModel.confirm.mockResolvedValue({ email: EMAIL, repo: REPO });

      await service.confirm(VALID_TOKEN);

      expect(mockModel.confirm).toHaveBeenCalledWith(VALID_TOKEN);
    });

    it('should throw TokenNotFoundError if the token does not exist', async () => {
      mockModel.confirm.mockResolvedValue(null);

      await expect(service.confirm(VALID_TOKEN)).rejects.toThrow(
        TokenNotFoundError,
      );
    });

    it('should throw InvalidTokenError if the token format is invalid', async () => {
      await expect(service.confirm('not-a-valid-token')).rejects.toThrow(
        InvalidTokenError,
      );
    });
  });

  describe('unsubscribe', () => {
    it('should remove the subscription from the database', async () => {
      mockModel.deleteByUnsubscribeToken.mockResolvedValue({
        email: EMAIL,
        repo: REPO,
      });

      await service.unsubscribe(VALID_TOKEN);

      expect(mockModel.deleteByUnsubscribeToken).toHaveBeenCalledWith(
        VALID_TOKEN,
      );
    });

    it('should throw TokenNotFoundError if the token does not exist', async () => {
      mockModel.deleteByUnsubscribeToken.mockResolvedValue(null);

      await expect(service.unsubscribe(VALID_TOKEN)).rejects.toThrow(
        TokenNotFoundError,
      );
    });

    it('should throw InvalidTokenError if the token format is invalid', async () => {
      await expect(service.unsubscribe('bad!')).rejects.toThrow(
        InvalidTokenError,
      );
    });
  });

  describe('getSubscriptions', () => {
    it('should return all confirmed subscriptions for a given email', async () => {
      const subscriptions = [
        { email: EMAIL, repo: REPO, confirmed: true, last_seen_tag: 'v1.2.3' },
        {
          email: EMAIL,
          repo: 'other/repo',
          confirmed: true,
          last_seen_tag: null,
        },
      ];
      mockModel.findByEmail.mockResolvedValue(subscriptions);

      const result = await service.getSubscriptions(EMAIL);

      expect(result).toEqual(subscriptions);
      expect(mockModel.findByEmail).toHaveBeenCalledWith(EMAIL);
    });

    it('should return an empty array if no subscriptions exist for the email', async () => {
      mockModel.findByEmail.mockResolvedValue([]);

      const result = await service.getSubscriptions(EMAIL);

      expect(result).toEqual([]);
    });
  });
});
