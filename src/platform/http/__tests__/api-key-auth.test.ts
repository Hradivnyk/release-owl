import type { Request, Response, NextFunction } from 'express';
import { apiKeyAuth } from '../api-key-auth.js';
import { UnauthorizedError } from '../../errors.js';
import { config } from '../../config/index.js';

jest.mock('../../config/index.js', () => ({
  config: {
    auth: { apiKey: '' },
  },
}));

// Cast away readonly so beforeEach can switch the key between scenarios.
// The mock object is not truly const, so mutation works at runtime.
const mutableConfig = config as { auth: { apiKey: string } };

function mockReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

const mockRes = {} as Response;

const CONFIGURED_KEY = 'test-api-key';

describe('apiKeyAuth middleware', () => {
  let next: jest.MockedFunction<NextFunction>;

  beforeEach(() => {
    next = jest.fn();
  });

  describe('when API_KEY is not configured', () => {
    beforeEach(() => {
      mutableConfig.auth.apiKey = '';
    });

    it('should call next(UnauthorizedError) when no header is provided', () => {
      apiKeyAuth(mockReq(), mockRes, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should call next(UnauthorizedError) even with a key provided', () => {
      apiKeyAuth(mockReq({ 'x-api-key': 'anything' }), mockRes, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });
  });

  describe('when API_KEY is configured', () => {
    beforeEach(() => {
      mutableConfig.auth.apiKey = CONFIGURED_KEY;
    });

    it('should call next() when the correct key is provided', () => {
      apiKeyAuth(mockReq({ 'x-api-key': CONFIGURED_KEY }), mockRes, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should call next(UnauthorizedError) when no header is provided', () => {
      apiKeyAuth(mockReq(), mockRes, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should call next(UnauthorizedError) when an empty string is provided', () => {
      apiKeyAuth(mockReq({ 'x-api-key': '' }), mockRes, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should call next(UnauthorizedError) when a wrong key is provided', () => {
      apiKeyAuth(mockReq({ 'x-api-key': 'wrong-key' }), mockRes, next);

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should call next(UnauthorizedError) when a key of different length is provided', () => {
      apiKeyAuth(
        mockReq({ 'x-api-key': CONFIGURED_KEY + 'extra' }),
        mockRes,
        next,
      );

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should respond with 401 status via error handler', () => {
      apiKeyAuth(mockReq({ 'x-api-key': 'bad' }), mockRes, next);

      const err = (next as jest.Mock).mock.calls[0][0] as UnauthorizedError;
      expect(err.statusCode).toBe(401);
      expect(err.message).toBe('Unauthorized');
    });
  });
});
