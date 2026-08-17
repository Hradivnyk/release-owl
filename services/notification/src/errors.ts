/**
 * Marks a failure as a known, upstream email-delivery problem (e.g. SMTP
 * rejected the message after retries were exhausted) as opposed to an
 * unexpected programming error. Callers use this distinction to decide
 * whether a request is worth retrying.
 */
export class EmailSendError extends Error {
  constructor(cause: unknown) {
    super('Failed to send email', { cause });
    this.name = 'EmailSendError';
  }
}
