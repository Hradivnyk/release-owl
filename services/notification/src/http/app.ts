import express, {
  type Request,
  type Response,
  type NextFunction,
  type Express,
} from 'express';
import { z } from 'zod';
import type { Notifier } from '../email.service.js';
import type { ILogger } from '../logger.js';

/**
 * Local request schema for the synchronous REST path.
 *
 * This intentionally omits saga_id — the REST /api/notify endpoint bypasses
 * the Saga entirely and calls EmailService directly, just like the gRPC path.
 * The broker consumer (email-requested.consumer.ts) keeps handling the
 * full saga flow; this server is a parallel alternative for benchmarking and
 * comparison against the gRPC transport.
 */
const ConfirmationPayloadSchema = z.object({
  type: z.literal('confirmation'),
  email: z.string().email(),
  repo: z.string().min(1),
  confirm_token: z.string().min(1),
});

const NotificationPayloadSchema = z.object({
  type: z.literal('notification'),
  email: z.string().email(),
  repo: z.string().min(1),
  tag_name: z.string().min(1),
  unsubscribe_token: z.string().min(1),
});

const NotifyPayloadSchema = z.discriminatedUnion('type', [
  ConfirmationPayloadSchema,
  NotificationPayloadSchema,
]);

type NotifyPayload = z.infer<typeof NotifyPayloadSchema>;

/**
 * Builds the notification HTTP service.
 *
 * A single POST /api/notify endpoint accepts the same discriminated payload
 * (by `type` field) used by the broker event, making it a drop-in synchronous
 * alternative.  This endpoint bypasses the Saga — email is sent inline and
 * the response reflects success or failure directly.
 *
 * Error mapping:
 *   400 — invalid/missing fields (Zod validation failure)
 *   202 — email accepted and sent
 *   502 — email send failed (SMTP / network error after retries)
 */
export function createRestApp(notifier: Notifier, logger: ILogger): Express {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response): void => {
    res.json({ status: 'ok' });
  });

  app.post(
    '/api/notify',
    async (req: Request, res: Response): Promise<void> => {
      const parsed = NotifyPayloadSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: 'invalid_request',
          details: parsed.error.flatten(),
        });
        return;
      }

      const payload: NotifyPayload = parsed.data;

      if (payload.type === 'confirmation') {
        await notifier.sendConfirmationEmail(
          payload.email,
          payload.confirm_token,
          payload.repo,
        );
        logger.info(
          { event: 'rest.notify.confirmation_sent', repo: payload.repo },
          'REST: confirmation email sent',
        );
      } else {
        await notifier.sendNotificationEmail(
          payload.email,
          payload.repo,
          payload.tag_name,
          payload.unsubscribe_token,
        );
        logger.info(
          {
            event: 'rest.notify.release_sent',
            repo: payload.repo,
            tag: payload.tag_name,
          },
          'REST: notification email sent',
        );
      }

      res.status(202).json({ status: 'sent' });
    },
  );

  // Error handler — catches thrown errors from the route (e.g. SMTP failures).
  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
      logger.error(
        { event: 'rest.notify.failed', err },
        'REST: email send failed',
      );
      res.status(502).json({ error: 'email_send_failed' });
    },
  );

  return app;
}
