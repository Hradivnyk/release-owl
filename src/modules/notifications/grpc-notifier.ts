import { credentials, Metadata, type ServiceError } from '@grpc/grpc-js';
import {
  NotificationServiceClient,
  type NotifyRequest,
} from '@release-owl/proto';
import type { ILogger } from '../../platform/logger.js';
import type { Notifier } from './notifier.js';

export interface GrpcNotifierConfig {
  grpcUrl: string;
  timeoutMs: number;
}

/**
 * Sends notification emails via gRPC to the notification service.
 *
 * This is a synchronous request-response path — the caller awaits the RPC
 * reply before continuing.  It runs parallel to (and bypasses) the default
 * RabbitMQ broker path; the Saga is not involved.
 *
 * Select this implementation by setting NOTIFIER=grpc in the environment.
 */
export class GrpcNotifier implements Notifier {
  private readonly client: NotificationServiceClient;

  constructor(
    private readonly config: GrpcNotifierConfig,
    private readonly logger: ILogger,
  ) {
    this.client = new NotificationServiceClient(
      config.grpcUrl,
      credentials.createInsecure(),
    );
  }

  async sendConfirmationEmail(
    email: string,
    token: string,
    repo: string,
  ): Promise<void> {
    const request: NotifyRequest = {
      kind: {
        $case: 'confirmation',
        confirmation: { email, repo, confirmToken: token },
      },
    };
    await this.call(request);
  }

  async sendNotificationEmail(
    email: string,
    repo: string,
    tag: string,
    token: string,
  ): Promise<void> {
    const request: NotifyRequest = {
      kind: {
        $case: 'notification',
        notification: { email, repo, tagName: tag, unsubscribeToken: token },
      },
    };
    await this.call(request);
  }

  private async call(request: NotifyRequest): Promise<void> {
    const deadline = new Date(Date.now() + this.config.timeoutMs);
    return new Promise((resolve, reject) => {
      this.client.notify(
        request,
        new Metadata(),
        { deadline },
        (err: ServiceError | null) => {
          if (err) {
            this.logger.error(
              {
                event: 'grpc.notify.error',
                code: err.code,
                message: err.message,
              },
              'gRPC Notify call failed',
            );
            reject(err);
            return;
          }
          resolve();
        },
      );
    });
  }
}
