import type { ILogger } from '@release-owl/platform';
import { SagaSweeper } from '../saga-sweeper.js';
import type { ISagaModel, SagaRow } from '../subscription-saga.model.js';
import type { SubscriptionSagaOrchestrator } from '../subscription-saga.orchestrator.js';

const SAGA_ID_1 = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SAGA_ID_2 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function makeRow(id: string): SagaRow {
  return {
    id,
    subscription_id: 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd',
    type: 'subscribe',
    status: 'started',
    created_at: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    updated_at: new Date(Date.now() - 60 * 60 * 1000),
  };
}

describe('SagaSweeper', () => {
  let sagaModel: jest.Mocked<ISagaModel>;
  let orchestrator: jest.Mocked<
    Pick<SubscriptionSagaOrchestrator, 'onEmailFailed'>
  >;
  let logger: ILogger;
  let sweeper: SagaSweeper;

  beforeEach(() => {
    sagaModel = {
      start: jest.fn(),
      findById: jest.fn(),
      findStartedOlderThan: jest.fn(),
      markCompleted: jest.fn(),
      markCompensated: jest.fn(),
    };
    orchestrator = {
      onEmailFailed: jest.fn().mockResolvedValue(undefined),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    sweeper = new SagaSweeper(
      sagaModel,
      orchestrator as unknown as SubscriptionSagaOrchestrator,
      logger,
      { intervalMs: 60_000, timeoutMs: 30 * 60 * 1000 },
    );
  });

  it('calls onEmailFailed for each stuck saga', async () => {
    sagaModel.findStartedOlderThan.mockResolvedValue([
      makeRow(SAGA_ID_1),
      makeRow(SAGA_ID_2),
    ]);

    await sweeper.sweep();

    expect(orchestrator.onEmailFailed).toHaveBeenCalledTimes(2);
    expect(orchestrator.onEmailFailed).toHaveBeenCalledWith(
      SAGA_ID_1,
      expect.stringContaining('timeout'),
    );
    expect(orchestrator.onEmailFailed).toHaveBeenCalledWith(
      SAGA_ID_2,
      expect.stringContaining('timeout'),
    );
  });

  it('does nothing when there are no stuck sagas', async () => {
    sagaModel.findStartedOlderThan.mockResolvedValue([]);

    await sweeper.sweep();

    expect(orchestrator.onEmailFailed).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('passes a cutoff date derived from timeoutMs to findStartedOlderThan', async () => {
    sagaModel.findStartedOlderThan.mockResolvedValue([]);
    const before = Date.now();

    await sweeper.sweep();

    const [cutoff] = sagaModel.findStartedOlderThan.mock.calls[0];
    const cutoffMs = cutoff.getTime();
    // cutoff should be approximately now - 30 min (allow 1 s margin for slow CI)
    expect(cutoffMs).toBeLessThan(before - 30 * 60 * 1000 + 1000);
    expect(cutoffMs).toBeGreaterThan(before - 30 * 60 * 1000 - 1000);
  });

  it('continues compensating remaining sagas when one compensation fails', async () => {
    sagaModel.findStartedOlderThan.mockResolvedValue([
      makeRow(SAGA_ID_1),
      makeRow(SAGA_ID_2),
    ]);
    orchestrator.onEmailFailed
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce(undefined);

    await sweeper.sweep();

    expect(orchestrator.onEmailFailed).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'saga.sweep_compensation_failed',
        sagaId: SAGA_ID_1,
      }),
      expect.any(String),
    );
  });

  it('sweep() propagates the error when findStartedOlderThan rejects', async () => {
    sagaModel.findStartedOlderThan.mockRejectedValue(new Error('DB down'));

    await expect(sweeper.sweep()).rejects.toThrow('DB down');
  });
});
