import {
  Server,
  ServerCredentials,
  status,
  type ServerUnaryCall,
  type sendUnaryData,
} from '@grpc/grpc-js';
import {
  NotificationServiceService,
  type NotifyRequest,
  type NotifyResponse,
} from '@release-owl/proto';
import type { Notifier } from '../email.service.js';
import type { ILogger } from '../logger.js';

/**
 * Classifies a send failure as transient (safe to retry) or permanent.
 *
 * Nodemailer / net errors that indicate the remote end is temporarily
 * unavailable are mapped to UNAVAILABLE; anything else to INTERNAL.
 * The caller (retry sender) has already exhausted its own retry budget,
 * so UNAVAILABLE here tells the gRPC client it is safe to try again later.
 */
function isTransient(err: unknown): boolean {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code ?? '';
    return (
      code === 'ECONNECTION' ||
      code === 'ETIMEDOUT' ||
      code === 'ESOCKET' ||
      code === 'EDNS' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND'
    );
  }
  return false;
}

/**
 * Creates and returns a grpc-js Server that exposes NotificationService.
 *
 * The server is NOT bound to a port here; call `server.bindAsync(...)` in
 * the boot sequence (index.ts) so the port is configurable and shutdown
 * can be cleanly orchestrated.
 */
export function createGrpcServer(notifier: Notifier, logger: ILogger): Server {
  const server = new Server();

  server.addService(NotificationServiceService, {
    async notify(
      call: ServerUnaryCall<NotifyRequest, NotifyResponse>,
      callback: sendUnaryData<NotifyResponse>,
    ): Promise<void> {
      const { kind } = call.request;

      // ── Validate ────────────────────────────────────────────────────────
      if (!kind) {
        callback({
          code: status.INVALID_ARGUMENT,
          message:
            'NotifyRequest.kind is required — set confirmation or notification',
        });
        return;
      }

      if (kind.$case === 'confirmation') {
        const { email, repo, confirmToken } = kind.confirmation;
        if (!email || !repo || !confirmToken) {
          callback({
            code: status.INVALID_ARGUMENT,
            message: 'confirmation requires email, repo, and confirm_token',
          });
          return;
        }
      } else {
        const { email, repo, tagName, unsubscribeToken } = kind.notification;
        if (!email || !repo || !tagName || !unsubscribeToken) {
          callback({
            code: status.INVALID_ARGUMENT,
            message:
              'notification requires email, repo, tag_name, and unsubscribe_token',
          });
          return;
        }
      }

      // ── Dispatch ─────────────────────────────────────────────────────────
      try {
        if (kind.$case === 'confirmation') {
          const { email, repo, confirmToken } = kind.confirmation;
          await notifier.sendConfirmationEmail(email, confirmToken, repo);
          logger.info(
            { event: 'grpc.notify.confirmation_sent', repo },
            'gRPC: confirmation email sent',
          );
        } else {
          const { email, repo, tagName, unsubscribeToken } = kind.notification;
          await notifier.sendNotificationEmail(
            email,
            repo,
            tagName,
            unsubscribeToken,
          );
          logger.info(
            { event: 'grpc.notify.release_sent', repo, tag: tagName },
            'gRPC: notification email sent',
          );
        }
        callback(null, {});
      } catch (err: unknown) {
        logger.error({ event: 'grpc.notify.failed', err }, 'Email send failed');
        const grpcStatus = isTransient(err)
          ? status.UNAVAILABLE
          : status.INTERNAL;
        const message = isTransient(err)
          ? 'temporary failure, please retry later'
          : 'internal error';
        callback({ code: grpcStatus, message });
      }
    },
  });

  return server;
}

export { Server, ServerCredentials };
