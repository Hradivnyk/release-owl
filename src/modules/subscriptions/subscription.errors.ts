import { AppError } from '../../platform/errors.js';

export class RepositoryNotFoundError extends AppError {
  constructor(repo: string) {
    super(`Repository not found: ${repo}`, 404);
  }
}

export class DuplicateSubscriptionError extends AppError {
  constructor(repo: string) {
    super(`Already subscribed to ${repo}`, 409);
  }
}

export class TokenNotFoundError extends AppError {
  constructor() {
    super('Token not found', 404);
  }
}

export class InvalidTokenError extends AppError {
  constructor() {
    super('Invalid token', 400);
  }
}
