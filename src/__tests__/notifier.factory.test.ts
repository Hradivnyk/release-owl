/**
 * Tests that createNotifier (the factory inside container.ts) returns the
 * right Notifier implementation for each value of NOTIFIER env var.
 *
 * We don't import container.ts directly (it has side effects — DB, broker).
 * Instead we test the factory logic through the implementations themselves:
 * BrokerNotifier, RestNotifier, and GrpcNotifier are each identifiable by
 * their constructor name.
 */
import { BrokerNotifier } from '../modules/notifications/broker-notifier.js';
import { RestNotifier } from '../modules/notifications/rest-notifier.js';
import { GrpcNotifier } from '../modules/notifications/grpc-notifier.js';
import type { Notifier } from '../modules/notifications/notifier.js';
import type { IBroker } from '@release-owl/platform';
import type { ILogger } from '../platform/logger.js';

const noopLogger: ILogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

const fakeBroker: IBroker = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  connect: jest.fn(),
  close: jest.fn(),
};

/**
 * Reproduces the createNotifier switch without importing container.ts.
 * Mirror any changes made to container.ts here.
 */
function createNotifier(notifierEnv: string): Notifier {
  switch (notifierEnv) {
    case 'rest':
      return new RestNotifier(
        { baseUrl: 'http://localhost:4000', timeoutMs: 5000 },
        noopLogger,
      );
    case 'grpc':
      return new GrpcNotifier(
        { grpcUrl: 'localhost:50051', timeoutMs: 5000 },
        noopLogger,
      );
    default:
      return new BrokerNotifier(fakeBroker);
  }
}

describe('createNotifier factory', () => {
  it('returns BrokerNotifier by default (NOTIFIER=broker)', () => {
    expect(createNotifier('broker')).toBeInstanceOf(BrokerNotifier);
  });

  it('returns BrokerNotifier when NOTIFIER is empty/unknown', () => {
    expect(createNotifier('')).toBeInstanceOf(BrokerNotifier);
    expect(createNotifier('unknown')).toBeInstanceOf(BrokerNotifier);
  });

  it('returns RestNotifier when NOTIFIER=rest', () => {
    expect(createNotifier('rest')).toBeInstanceOf(RestNotifier);
  });

  it('returns GrpcNotifier when NOTIFIER=grpc', () => {
    expect(createNotifier('grpc')).toBeInstanceOf(GrpcNotifier);
  });
});
