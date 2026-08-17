import type { IEmailSender } from './email.sender.js';
import type { IEmailTemplateBuilder } from './email-template.builder.js';
import { EmailSendError } from './errors.js';

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

export class EmailService implements Notifier {
  constructor(
    private readonly sender: IEmailSender,
    private readonly templates: IEmailTemplateBuilder,
  ) {}

  async sendConfirmationEmail(
    email: string,
    token: string,
    repo: string,
  ): Promise<void> {
    await this.send(this.templates.confirmationEmail(email, token, repo));
  }

  async sendNotificationEmail(
    email: string,
    repo: string,
    tag: string,
    token: string,
  ): Promise<void> {
    await this.send(this.templates.notificationEmail(email, repo, tag, token));
  }

  private async send(
    options: Parameters<IEmailSender['send']>[0],
  ): Promise<void> {
    try {
      await this.sender.send(options);
    } catch (err) {
      throw new EmailSendError(err);
    }
  }
}
