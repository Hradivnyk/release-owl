/**
 * Port the rest of the application depends on to notify subscribers. The
 * transport behind it (broker event, HTTP call, in-process) is an
 * implementation detail of the adapter wired in the container.
 */
export interface Notifier {
  sendConfirmationEmail(
    email: string,
    token: string,
    repo: string,
  ): Promise<void>;
  sendNotificationEmail(
    email: string,
    repo: string,
    tag: string,
    token: string,
  ): Promise<void>;
}
