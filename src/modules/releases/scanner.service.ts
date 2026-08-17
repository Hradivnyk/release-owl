import { config } from '../../platform/config/index.js';
import { scannerScanDurationSeconds } from '../../metrics/index.js';
import type {
  ConfirmedSubscriptionsProvider,
  ConfirmedSubscriptionWithToken,
} from '../subscriptions/index.js';
import type { IGithubService } from '../github/index.js';
import { GitHubRateLimitError } from '../github/index.js';
import type { ILogger } from '../../platform/logger.js';
import type { Scheduler } from '../../platform/scheduler.js';
import type { ReleaseHandler } from './release.handler.js';

function groupByRepo(
  subscriptions: ConfirmedSubscriptionWithToken[],
): Map<string, ConfirmedSubscriptionWithToken[]> {
  const map = new Map<string, ConfirmedSubscriptionWithToken[]>();
  for (const sub of subscriptions) {
    const list = map.get(sub.repo) ?? [];
    list.push(sub);
    map.set(sub.repo, list);
  }
  return map;
}

export class ScannerService {
  private scanning = false;

  constructor(
    private readonly subscriptions: ConfirmedSubscriptionsProvider,
    private readonly githubService: IGithubService,
    private readonly releaseHandler: ReleaseHandler,
    private readonly logger: ILogger,
    private readonly scheduler: Scheduler,
  ) {}

  private async processRepo(
    repo: string,
    subscribers: ConfirmedSubscriptionWithToken[],
  ): Promise<void> {
    try {
      const release = await this.githubService.getLatestRelease(repo);

      if (!release) {
        this.logger.debug(
          { event: 'scanner.no_releases', repo },
          'No releases found',
        );
        return;
      }

      const lastSeenTag = subscribers[0].last_seen_tag;

      if (release.tag_name === lastSeenTag) {
        this.logger.debug(
          { event: 'scanner.no_new_release', repo, tag: release.tag_name },
          'No new release',
        );
        return;
      }

      this.logger.info(
        { event: 'scanner.release_detected', repo, tag: release.tag_name },
        'New release detected',
      );

      await this.releaseHandler.handle(repo, release, subscribers);
    } catch (err) {
      if (err instanceof GitHubRateLimitError) throw err;
      this.logger.error(
        { event: 'scanner.repo_error', err, repo },
        'Error processing repo',
      );
    }
  }

  async scan(): Promise<void> {
    if (this.scanning) {
      this.logger.warn(
        { event: 'scanner.already_running' },
        'Scan already in progress, skipping',
      );
      return;
    }
    this.scanning = true;
    const endTimer = scannerScanDurationSeconds.startTimer();
    let result = 'success';
    try {
      this.logger.info(
        { event: 'scanner.check_started' },
        'Starting release check',
      );

      const subscriptions =
        await this.subscriptions.findAllConfirmedWithTokens();

      if (subscriptions.length === 0) {
        this.logger.info(
          { event: 'scanner.no_subscriptions' },
          'No active subscriptions, skipping',
        );
        return;
      }

      const byRepo = groupByRepo(subscriptions);

      for (const [repo, subscribers] of byRepo.entries()) {
        // eslint-disable-next-line no-await-in-loop
        await this.processRepo(repo, subscribers); // sequential to respect GitHub API rate limits
      }

      this.logger.info(
        { event: 'scanner.check_complete' },
        'Release check complete',
      );
    } catch (err) {
      result = 'error';
      throw err;
    } finally {
      endTimer({ result });
      this.scanning = false;
    }
  }

  start(): void {
    this.scheduler.schedule(config.scanner.cronSchedule, () => {
      this.scan().catch((err: unknown) => {
        this.logger.error(
          { event: 'scanner.unhandled_error', err },
          'Unhandled error during scan',
        );
      });
    });

    this.logger.info(
      { event: 'scanner.scheduled', schedule: config.scanner.cronSchedule },
      'Scanner scheduled',
    );
  }
}
