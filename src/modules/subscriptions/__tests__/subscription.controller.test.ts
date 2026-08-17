import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  DuplicateSubscriptionError,
  RepositoryNotFoundError,
  TokenNotFoundError,
} from '../subscription.errors.js';
import { SubscriptionController } from '../subscription.controller.js';
import type { ISubscriptionService } from '../subscription.types.js';

const VALID_TOKEN = 'a'.repeat(64);
const EMAIL = 'user@example.com';
const REPO = 'owner/repo';

function mockReq(
  overrides: {
    body?: Record<string, unknown>;
    params?: Record<string, string>;
    query?: Record<string, unknown>;
  } = {},
): Request {
  return {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
  } as unknown as Request;
}

function mockRes(): { res: Response; status: jest.Mock; json: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { res: { status } as unknown as Response, status, json };
}

describe('SubscriptionController', () => {
  let controller: SubscriptionController;
  let mockService: jest.Mocked<ISubscriptionService>;
  let next: NextFunction;

  beforeEach(() => {
    mockService = {
      subscribe: jest.fn(),
      confirm: jest.fn(),
      unsubscribe: jest.fn(),
      getSubscriptions: jest.fn(),
    };
    controller = new SubscriptionController(mockService);
    next = jest.fn();
  });

  describe('subscribe', () => {
    it('should call subscriptionService.subscribe with email and repo from request body', async () => {
      mockService.subscribe.mockResolvedValue(undefined);
      const { res } = mockRes();

      await controller.subscribe(
        mockReq({ body: { email: EMAIL, repo: REPO } }),
        res,
        next,
      );

      expect(mockService.subscribe).toHaveBeenCalledWith(EMAIL, REPO);
    });

    it('should return 200 on successful subscription', async () => {
      mockService.subscribe.mockResolvedValue(undefined);
      const { res, status, json } = mockRes();

      await controller.subscribe(
        mockReq({ body: { email: EMAIL, repo: REPO } }),
        res,
        next,
      );

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('should call next with ZodError if email is missing from request body', async () => {
      const { res } = mockRes();

      await controller.subscribe(mockReq({ body: { repo: REPO } }), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should call next with ZodError if repo is missing from request body', async () => {
      const { res } = mockRes();

      await controller.subscribe(
        mockReq({ body: { email: EMAIL } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should call next with ZodError if email format is invalid', async () => {
      const { res } = mockRes();

      await controller.subscribe(
        mockReq({ body: { email: 'not-an-email', repo: REPO } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should call next with ZodError if repo does not match owner/repo format', async () => {
      const { res } = mockRes();

      await controller.subscribe(
        mockReq({ body: { email: EMAIL, repo: 'invalid-repo-format' } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should call next with RepositoryNotFoundError when service throws it', async () => {
      const error = new RepositoryNotFoundError(REPO);
      mockService.subscribe.mockRejectedValue(error);
      const { res } = mockRes();

      await controller.subscribe(
        mockReq({ body: { email: EMAIL, repo: REPO } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
    });

    it('should call next with DuplicateSubscriptionError when service throws it', async () => {
      const error = new DuplicateSubscriptionError(REPO);
      mockService.subscribe.mockRejectedValue(error);
      const { res } = mockRes();

      await controller.subscribe(
        mockReq({ body: { email: EMAIL, repo: REPO } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('confirmSubscription', () => {
    it('should call subscriptionService.confirm with token from request params', async () => {
      mockService.confirm.mockResolvedValue(undefined);
      const { res } = mockRes();

      await controller.confirmSubscription(
        mockReq({ params: { token: VALID_TOKEN } }),
        res,
        next,
      );

      expect(mockService.confirm).toHaveBeenCalledWith(VALID_TOKEN);
    });

    it('should return 200 on successful confirmation', async () => {
      mockService.confirm.mockResolvedValue(undefined);
      const { res, status, json } = mockRes();

      await controller.confirmSubscription(
        mockReq({ params: { token: VALID_TOKEN } }),
        res,
        next,
      );

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('should call next with ZodError if token format is invalid', async () => {
      const { res } = mockRes();

      await controller.confirmSubscription(
        mockReq({ params: { token: 'not-a-valid-token' } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should call next with TokenNotFoundError when service throws it', async () => {
      const error = new TokenNotFoundError();
      mockService.confirm.mockRejectedValue(error);
      const { res } = mockRes();

      await controller.confirmSubscription(
        mockReq({ params: { token: VALID_TOKEN } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('unsubscribe', () => {
    it('should call subscriptionService.unsubscribe with token from request params', async () => {
      mockService.unsubscribe.mockResolvedValue(undefined);
      const { res } = mockRes();

      await controller.unsubscribe(
        mockReq({ params: { token: VALID_TOKEN } }),
        res,
        next,
      );

      expect(mockService.unsubscribe).toHaveBeenCalledWith(VALID_TOKEN);
    });

    it('should return 200 on successful unsubscription', async () => {
      mockService.unsubscribe.mockResolvedValue(undefined);
      const { res, status, json } = mockRes();

      await controller.unsubscribe(
        mockReq({ params: { token: VALID_TOKEN } }),
        res,
        next,
      );

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.any(String) }),
      );
    });

    it('should call next with ZodError if token format is invalid', async () => {
      const { res } = mockRes();

      await controller.unsubscribe(
        mockReq({ params: { token: 'bad-token' } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should call next with TokenNotFoundError when service throws it', async () => {
      const error = new TokenNotFoundError();
      mockService.unsubscribe.mockRejectedValue(error);
      const { res } = mockRes();

      await controller.unsubscribe(
        mockReq({ params: { token: VALID_TOKEN } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('getSubscriptions', () => {
    const subscriptions = [
      { email: EMAIL, repo: REPO, confirmed: true, last_seen_tag: 'v1.0.0' },
    ];

    it('should call subscriptionService.getSubscriptions with email from query params', async () => {
      mockService.getSubscriptions.mockResolvedValue(subscriptions);
      const { res } = mockRes();

      await controller.getSubscriptions(
        mockReq({ query: { email: EMAIL } }),
        res,
        next,
      );

      expect(mockService.getSubscriptions).toHaveBeenCalledWith(EMAIL);
    });

    it('should return 200 and an array of subscriptions', async () => {
      mockService.getSubscriptions.mockResolvedValue(subscriptions);
      const { res, status, json } = mockRes();

      await controller.getSubscriptions(
        mockReq({ query: { email: EMAIL } }),
        res,
        next,
      );

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith(subscriptions);
    });

    it('should return 200 and an empty array if no subscriptions found', async () => {
      mockService.getSubscriptions.mockResolvedValue([]);
      const { res, status, json } = mockRes();

      await controller.getSubscriptions(
        mockReq({ query: { email: EMAIL } }),
        res,
        next,
      );

      expect(status).toHaveBeenCalledWith(200);
      expect(json).toHaveBeenCalledWith([]);
    });

    it('should call next with ZodError if email query param is missing', async () => {
      const { res } = mockRes();

      await controller.getSubscriptions(mockReq({ query: {} }), res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });

    it('should call next with ZodError if email format is invalid', async () => {
      const { res } = mockRes();

      await controller.getSubscriptions(
        mockReq({ query: { email: 'not-an-email' } }),
        res,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(ZodError));
    });
  });
});
