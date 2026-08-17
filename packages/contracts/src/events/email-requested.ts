import { z } from 'zod';

export const ConfirmationEmailRequestedSchema = z.object({
  type: z.literal('confirmation'),
  event_id: z.string(),
  email: z.string().email(),
  repo: z.string(),
  confirm_token: z.string(),
  // Correlation id used by the orchestrated Saga so the app service can match
  // the reply (email.sent / email.failed) back to the pending subscription.
  saga_id: z.string().uuid(),
});

export const NotificationEmailRequestedSchema = z.object({
  type: z.literal('notification'),
  event_id: z.string(),
  email: z.string().email(),
  repo: z.string(),
  tag_name: z.string(),
  unsubscribe_token: z.string(),
});

export const EmailRequestedPayloadSchema = z.discriminatedUnion('type', [
  ConfirmationEmailRequestedSchema,
  NotificationEmailRequestedSchema,
]);

export type EmailRequestedPayload = z.infer<typeof EmailRequestedPayloadSchema>;
export type ConfirmationEmailRequested = z.infer<
  typeof ConfirmationEmailRequestedSchema
>;
export type NotificationEmailRequested = z.infer<
  typeof NotificationEmailRequestedSchema
>;

export const EMAIL_REQUESTED = 'email.requested' as const;
