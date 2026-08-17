import { RetryingEmailSender } from '../retrying-email.sender.js';
import type { IEmailSender, SendMailOptions } from '../email.sender.js';
import type { ILogger } from '../logger.js';

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const MAIL: SendMailOptions = { to: 'a@b.com', subject: 's', text: 't' };

describe('RetryingEmailSender', () => {
  it('returns after the first successful attempt', async () => {
    const inner: IEmailSender = {
      send: jest.fn().mockResolvedValue(undefined),
    };
    const sender = new RetryingEmailSender(
      inner,
      { attempts: 3, backoffMs: 1 },
      noopLogger,
    );

    await sender.send(MAIL);

    expect(inner.send).toHaveBeenCalledTimes(1);
  });

  it('retries transient failures and eventually succeeds', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('smtp down'))
      .mockResolvedValueOnce(undefined);
    const sender = new RetryingEmailSender(
      { send },
      { attempts: 3, backoffMs: 1 },
      noopLogger,
    );

    await sender.send(MAIL);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it('throws once retries are exhausted', async () => {
    const send = jest.fn().mockRejectedValue(new Error('smtp down'));
    const sender = new RetryingEmailSender(
      { send },
      { attempts: 3, backoffMs: 1 },
      noopLogger,
    );

    await expect(sender.send(MAIL)).rejects.toThrow('smtp down');
    expect(send).toHaveBeenCalledTimes(3);
  });
});
