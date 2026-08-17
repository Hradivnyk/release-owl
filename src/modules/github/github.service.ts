import { GitHubRateLimitError } from './github.errors.js';
import { githubApiRequestsTotal } from '../../metrics/index.js';
import logger from '../../platform/logger.js';
import type { IHttpClient } from './http-client.js';

// GITHUB_API_URL can be overridden in tests to point to a local mock server
// instead of the real GitHub API, avoiding external network calls in E2E.
const GITHUB_API = process.env.GITHUB_API_URL ?? 'https://api.github.com';

export interface Release {
  tag_name: string;
  html_url: string;
}

export interface IGithubService {
  repositoryExists(repo: string): Promise<boolean>;
  getLatestRelease(repo: string): Promise<Release | null>;
}

export class GithubService implements IGithubService {
  private readonly headers: HeadersInit;

  constructor(
    private readonly httpClient: IHttpClient,
    token?: string,
  ) {
    this.headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  /** Throws GitHubRateLimitError when the response status is 403 or 429.
   *  Both status codes can indicate either a primary or secondary rate limit.
   *  Priority for determining resetAt (per GitHub docs):
   *  1. Retry-After header (seconds) — present on secondary rate limit responses.
   *  2. X-RateLimit-Reset header (Unix seconds) — present when x-ratelimit-remaining is 0.
   *  3. Fallback: now + 60 seconds. */
  private handleRateLimit(
    response: Response,
    repo: string,
    operation: string,
  ): void {
    if (response.status !== 429 && response.status !== 403) return;

    githubApiRequestsTotal.inc({ operation, result: 'rate_limited' });

    const retryAfter = response.headers.get('Retry-After');
    if (retryAfter) {
      const resetAt = new Date(Date.now() + Number(retryAfter) * 1000);
      logger.warn(
        { event: 'github.rate_limit', repo, status: response.status, resetAt },
        'GitHub rate limit hit (Retry-After)',
      );
      throw new GitHubRateLimitError(resetAt);
    }

    const resetHeader = response.headers.get('X-RateLimit-Reset');
    const resetAt = resetHeader
      ? new Date(Number(resetHeader) * 1000)
      : new Date(Date.now() + 60_000);

    logger.warn(
      { event: 'github.rate_limit', repo, status: response.status, resetAt },
      'GitHub rate limit hit (X-RateLimit-Reset)',
    );
    throw new GitHubRateLimitError(resetAt);
  }

  /** Returns true if the repository exists on GitHub (status 200), false on 404.
   *  Throws GitHubRateLimitError on 403 or 429 (primary or secondary rate limit),
   *  generic Error on any other unexpected status. */
  async repositoryExists(repo: string): Promise<boolean> {
    logger.debug(
      { event: 'github.repo_check', repo },
      'Checking repo existence',
    );

    const response = await this.httpClient.get(
      `${GITHUB_API}/repos/${repo}`,
      this.headers,
      { timeoutMs: 10_000 },
    );

    if (response.status === 200) {
      logger.debug({ event: 'github.repo_found', repo }, 'Repo exists');
      githubApiRequestsTotal.inc({ operation: 'repo_check', result: 'found' });
      return true;
    }
    if (response.status === 404) {
      logger.debug({ event: 'github.repo_not_found', repo }, 'Repo not found');
      githubApiRequestsTotal.inc({
        operation: 'repo_check',
        result: 'not_found',
      });
      return false;
    }

    this.handleRateLimit(response, repo, 'repo_check');

    githubApiRequestsTotal.inc({ operation: 'repo_check', result: 'error' });
    throw new Error(
      `GitHub API returned unexpected status ${response.status} for repo "${repo}"`,
    );
  }

  /** Returns the latest release tag_name and html_url, or null if no releases exist.
   *  Throws GitHubRateLimitError on 403 or 429 (primary or secondary rate limit),
   *  generic Error on any other unexpected status. */
  async getLatestRelease(repo: string): Promise<Release | null> {
    logger.debug(
      { event: 'github.release_fetch', repo },
      'Fetching latest release',
    );

    const response = await this.httpClient.get(
      `${GITHUB_API}/repos/${repo}/releases/latest`,
      this.headers,
      { timeoutMs: 10_000 },
    );

    if (response.status === 404) {
      logger.debug(
        { event: 'github.release_not_found', repo },
        'No releases found',
      );
      githubApiRequestsTotal.inc({
        operation: 'release_fetch',
        result: 'not_found',
      });
      return null;
    }
    if (response.status === 200) {
      const data = (await response.json()) as {
        tag_name: string;
        html_url: string;
      };
      logger.debug(
        { event: 'github.release_fetched', repo, tag: data.tag_name },
        'Latest release fetched',
      );
      githubApiRequestsTotal.inc({
        operation: 'release_fetch',
        result: 'found',
      });
      return { tag_name: data.tag_name, html_url: data.html_url };
    }

    this.handleRateLimit(response, repo, 'release_fetch');

    githubApiRequestsTotal.inc({ operation: 'release_fetch', result: 'error' });
    throw new Error(
      `GitHub API returned unexpected status ${response.status} for releases of "${repo}"`,
    );
  }
}
