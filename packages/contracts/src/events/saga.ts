import { z } from 'zod';

// Reply events published by the notification service back to the app orchestrator.
// Both carry `saga_id` so the orchestrator can correlate replies to the pending saga.

export const EmailSentSchema = z.object({
  saga_id: z.string().uuid(),
  repo: z.string(),
});

export const EmailFailedSchema = z.object({
  saga_id: z.string().uuid(),
  repo: z.string(),
  reason: z.string(),
});

export type EmailSentPayload = z.infer<typeof EmailSentSchema>;
export type EmailFailedPayload = z.infer<typeof EmailFailedSchema>;

export const EMAIL_SENT = 'email.sent' as const;
export const EMAIL_FAILED = 'email.failed' as const;
