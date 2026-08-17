import nodemailer from 'nodemailer';

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
}

export interface IEmailSender {
  send(options: SendMailOptions): Promise<void>;
}

export interface EmailSenderConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
}

export class NodemailerEmailSender implements IEmailSender {
  private readonly transporter;

  constructor(private readonly config: EmailSenderConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  async send({ to, subject, text }: SendMailOptions): Promise<void> {
    await this.transporter.sendMail({
      from: this.config.from,
      to,
      subject,
      text,
    });
  }
}
