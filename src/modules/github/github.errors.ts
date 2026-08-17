import { AppError } from '../../platform/errors.js';

export class GitHubRateLimitError extends AppError {
  /** Date after which the rate limit resets. */
  constructor(public readonly resetAt: Date) {
    super(
      `GitHub API rate limit exceeded. Resets at ${resetAt.toISOString()}.`,
      429,
    );
  }
}
