import { GitHubRateLimitError } from '../github.errors.js';
import { GithubService } from '../github.service.js';
import type { IHttpClient } from '../http-client.js';

function mockResponse(
  status: number,
  body?: object,
  headers?: Record<string, string>,
): Response {
  return {
    status,
    json: jest.fn().mockResolvedValue(body ?? {}),
    headers: {
      get: (key: string) => headers?.[key] ?? null,
    },
  } as unknown as Response;
}

describe('GithubService', () => {
  let mockGet: jest.Mock<Promise<Response>>;
  let httpClient: IHttpClient;
  let service: GithubService;

  beforeEach(() => {
    mockGet = jest.fn();
    httpClient = { get: mockGet };
    service = new GithubService(httpClient);
  });

  describe('repositoryExists', () => {
    it('should return true if GitHub API responds with 200 for a valid repository', async () => {
      mockGet.mockResolvedValue(mockResponse(200));

      const result = await service.repositoryExists('owner/repo');

      expect(result).toBe(true);
    });

    it('should return false if GitHub API responds with 404', async () => {
      mockGet.mockResolvedValue(mockResponse(404));

      const result = await service.repositoryExists('owner/nonexistent');

      expect(result).toBe(false);
    });

    it('should throw GitHubRateLimitError and use Retry-After when present (takes priority)', async () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 3600;
      mockGet.mockResolvedValue(
        mockResponse(
          429,
          {},
          {
            'Retry-After': '120',
            'X-RateLimit-Reset': String(resetUnix),
          },
        ),
      );

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw GitHubRateLimitError and use X-RateLimit-Reset when Retry-After is absent', async () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 3600;
      mockGet.mockResolvedValue(
        mockResponse(429, {}, { 'X-RateLimit-Reset': String(resetUnix) }),
      );

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw GitHubRateLimitError with a fallback resetAt when the header is missing', async () => {
      mockGet.mockResolvedValue(mockResponse(429));

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw GitHubRateLimitError on 403 with X-RateLimit-Remaining: 0', async () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 3600;
      mockGet.mockResolvedValue(
        mockResponse(
          403,
          {},
          {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(resetUnix),
          },
        ),
      );

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw GitHubRateLimitError on 403 with Retry-After header', async () => {
      mockGet.mockResolvedValue(mockResponse(403, {}, { 'Retry-After': '60' }));

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw GitHubRateLimitError on 403 with X-RateLimit-Reset when Retry-After is absent', async () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 3600;
      mockGet.mockResolvedValue(
        mockResponse(403, {}, { 'X-RateLimit-Reset': String(resetUnix) }),
      );

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw an error if GitHub API returns an unexpected status code', async () => {
      mockGet.mockResolvedValue(mockResponse(500));

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        /unexpected status 500/,
      );
    });

    it('should throw an error if the network request fails', async () => {
      mockGet.mockRejectedValue(new Error('Network error'));

      await expect(service.repositoryExists('owner/repo')).rejects.toThrow(
        'Network error',
      );
    });
  });

  describe('getLatestRelease', () => {
    it('should return the latest release tag for a repository', async () => {
      mockGet.mockResolvedValue(
        mockResponse(200, {
          tag_name: 'v1.2.3',
          html_url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
        }),
      );

      const release = await service.getLatestRelease('owner/repo');

      expect(release).toEqual({
        tag_name: 'v1.2.3',
        html_url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
      });
    });

    it('should return null if the repository has no releases', async () => {
      mockGet.mockResolvedValue(mockResponse(404));

      const release = await service.getLatestRelease('owner/repo');

      expect(release).toBeNull();
    });

    it('should throw GitHubRateLimitError and use Retry-After when present (takes priority)', async () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 3600;
      mockGet.mockResolvedValue(
        mockResponse(
          429,
          {},
          {
            'Retry-After': '120',
            'X-RateLimit-Reset': String(resetUnix),
          },
        ),
      );

      await expect(service.getLatestRelease('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw GitHubRateLimitError and use X-RateLimit-Reset when Retry-After is absent', async () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 3600;
      mockGet.mockResolvedValue(
        mockResponse(429, {}, { 'X-RateLimit-Reset': String(resetUnix) }),
      );

      await expect(service.getLatestRelease('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw GitHubRateLimitError on 403 with X-RateLimit-Remaining: 0', async () => {
      const resetUnix = Math.floor(Date.now() / 1000) + 3600;
      mockGet.mockResolvedValue(
        mockResponse(
          403,
          {},
          {
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(resetUnix),
          },
        ),
      );

      await expect(service.getLatestRelease('owner/repo')).rejects.toThrow(
        GitHubRateLimitError,
      );
    });

    it('should throw an error if GitHub API returns an unexpected status code', async () => {
      mockGet.mockResolvedValue(mockResponse(503));

      await expect(service.getLatestRelease('owner/repo')).rejects.toThrow(
        /unexpected status 503/,
      );
    });

    it('should throw an error if the network request fails', async () => {
      mockGet.mockRejectedValue(new Error('Connection refused'));

      await expect(service.getLatestRelease('owner/repo')).rejects.toThrow(
        'Connection refused',
      );
    });
  });
});
