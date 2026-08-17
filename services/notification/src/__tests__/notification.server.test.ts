import { status as grpcStatus } from '@grpc/grpc-js';
import { createGrpcServer } from '../grpc/notification.server.js';
import type { Notifier } from '../email.service.js';
import type { ILogger } from '../logger.js';

// ── Fakes ──────────────────────────────────────────────────────────────────

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function makeNotifier(override?: Partial<Notifier>): Notifier {
  return {
    sendConfirmationEmail: jest.fn().mockResolvedValue(undefined),
    sendNotificationEmail: jest.fn().mockResolvedValue(undefined),
    ...override,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extracts the `notify` handler from the registered service so tests can
 * invoke it directly without starting a real TCP listener.
 */
function extractHandler(
  notifier: Notifier,
): (
  call: { request: unknown },
  callback: (
    err: { code: number; message: string } | null,
    res?: unknown,
  ) => void,
) => Promise<void> {
  const server = createGrpcServer(notifier, noopLogger);
  // grpc-js stores handlers in the private _handlers map keyed by method path.
  // We reach into it to avoid needing a real network connection in unit tests.
  const handlers = (
    server as unknown as {
      handlers: Map<string, { func: unknown }>;
    }
  ).handlers;
  const entry = handlers.get(
    '/releaseowl.notification.v1.NotificationService/Notify',
  );
  if (!entry) throw new Error('Notify handler not registered');
  return entry.func as (
    call: { request: unknown },
    callback: (
      err: { code: number; message: string } | null,
      res?: unknown,
    ) => void,
  ) => Promise<void>;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('gRPC NotificationService.Notify — status code mapping', () => {
  it('returns INVALID_ARGUMENT when kind is missing', async () => {
    const handler = extractHandler(makeNotifier());
    const cb = jest.fn();
    await handler({ request: { kind: undefined } }, cb);
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
    );
  });

  it('returns INVALID_ARGUMENT when notification fields are empty', async () => {
    const handler = extractHandler(makeNotifier());
    const cb = jest.fn();
    await handler(
      {
        request: {
          kind: {
            $case: 'notification',
            notification: {
              email: '',
              repo: 'o/r',
              tagName: 'v1',
              unsubscribeToken: 'tok',
            },
          },
        },
      },
      cb,
    );
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.INVALID_ARGUMENT }),
    );
  });

  it('calls sendNotificationEmail and replies with null error on success', async () => {
    const notifier = makeNotifier();
    const handler = extractHandler(notifier);
    const cb = jest.fn();

    await handler(
      {
        request: {
          kind: {
            $case: 'notification',
            notification: {
              email: 'a@b.com',
              repo: 'o/r',
              tagName: 'v1',
              unsubscribeToken: 'tok',
            },
          },
        },
      },
      cb,
    );

    expect(notifier.sendNotificationEmail).toHaveBeenCalledWith(
      'a@b.com',
      'o/r',
      'v1',
      'tok',
    );
    expect(cb).toHaveBeenCalledWith(null, {});
  });

  it('returns UNAVAILABLE for transient SMTP errors', async () => {
    const transientErr = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    });
    const notifier = makeNotifier({
      sendNotificationEmail: jest.fn().mockRejectedValue(transientErr),
    });
    const handler = extractHandler(notifier);
    const cb = jest.fn();

    await handler(
      {
        request: {
          kind: {
            $case: 'notification',
            notification: {
              email: 'a@b.com',
              repo: 'o/r',
              tagName: 'v1',
              unsubscribeToken: 'tok',
            },
          },
        },
      },
      cb,
    );

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.UNAVAILABLE }),
    );
  });

  it('returns INTERNAL for non-transient errors', async () => {
    const permanentErr = new Error('template rendering failed');
    const notifier = makeNotifier({
      sendNotificationEmail: jest.fn().mockRejectedValue(permanentErr),
    });
    const handler = extractHandler(notifier);
    const cb = jest.fn();

    await handler(
      {
        request: {
          kind: {
            $case: 'notification',
            notification: {
              email: 'a@b.com',
              repo: 'o/r',
              tagName: 'v1',
              unsubscribeToken: 'tok',
            },
          },
        },
      },
      cb,
    );

    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({ code: grpcStatus.INTERNAL }),
    );
  });

  it('calls sendConfirmationEmail for confirmation kind', async () => {
    const notifier = makeNotifier();
    const handler = extractHandler(notifier);
    const cb = jest.fn();

    await handler(
      {
        request: {
          kind: {
            $case: 'confirmation',
            confirmation: {
              email: 'a@b.com',
              repo: 'o/r',
              confirmToken: 'tok',
            },
          },
        },
      },
      cb,
    );

    expect(notifier.sendConfirmationEmail).toHaveBeenCalledWith(
      'a@b.com',
      'tok',
      'o/r',
    );
    expect(cb).toHaveBeenCalledWith(null, {});
  });
});
