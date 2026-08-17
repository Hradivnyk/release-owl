import type { SendMailOptions } from './email.sender.js';

export interface IEmailTemplateBuilder {
  confirmationEmail(
    email: string,
    token: string,
    repo: string,
  ): SendMailOptions;
  notificationEmail(
    email: string,
    repo: string,
    tag: string,
    token: string,
  ): SendMailOptions;
}

export class EmailTemplateBuilder implements IEmailTemplateBuilder {
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.trim().replace(/\/$/, '');
  }

  private readonly baseUrl: string;

  confirmationEmail(
    email: string,
    token: string,
    repo: string,
  ): SendMailOptions {
    const confirmUrl = `${this.baseUrl}/api/confirm/${token}`;
    return {
      to: email,
      subject: `Confirm your subscription to ${repo}`,
      text: [
        `You requested to subscribe to GitHub release notifications for: ${repo}`,
        '',
        'To confirm your subscription, click the link below:',
        confirmUrl,
        '',
        'If you did not make this request, ignore this email.',
      ].join('\n'),
    };
  }

  notificationEmail(
    email: string,
    repo: string,
    tag: string,
    token: string,
  ): SendMailOptions {
    const unsubscribeUrl = `${this.baseUrl}/api/unsubscribe/${token}`;
    return {
      to: email,
      subject: `New release of ${repo}: ${tag}`,
      text: [
        `A new release of ${repo} is available: ${tag}`,
        '',
        'To unsubscribe from notifications for this repository, follow this link:',
        unsubscribeUrl,
      ].join('\n'),
    };
  }
}
