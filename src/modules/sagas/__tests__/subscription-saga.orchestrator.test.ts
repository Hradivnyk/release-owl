import type { Knex } from 'knex';
import type { ILogger } from '@release-owl/platform';
import { SubscriptionSagaOrchestrator } from '../subscription-saga.orchestrator.js';
import type { ISagaModel, SagaRow } from '../subscription-saga.model.js';
import type { ISubscriptionModel } from '../../subscriptions/subscription.model.js';

const SAGA_ID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const SUBSCRIPTION_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

function makeSagaRow(status: SagaRow['status']): SagaRow {
  return {
    id: SAGA_ID,
    subscription_id: SUBSCRIPTION_ID,
    type: 'subscribe',
    status,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

describe('SubscriptionSagaOrchestrator', () => {
  let sagaModel: jest.Mocked<ISagaModel>;
  let subscriptionModel: jest.Mocked<Pick<ISubscriptionModel, 'deleteById'>>;
  let mockUow: { run: jest.Mock };
  let logger: ILogger;
  let orchestrator: SubscriptionSagaOrchestrator;
  const fakeTrx = {} as Knex.Transaction;

  beforeEach(() => {
    sagaModel = {
      start: jest.fn(),
      findById: jest.fn(),
      findStartedOlderThan: jest.fn(),
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markCompensated: jest.fn().mockResolvedValue(undefined),
    };
    subscriptionModel = {
      deleteById: jest.fn().mockResolvedValue(undefined),
    };
    mockUow = {
      run: jest.fn(async (work: (trx: Knex.Transaction) => Promise<unknown>) =>
        work(fakeTrx),
      ),
    };
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    // Pass initialDelayMs: 0 so retry tests don't add real delays.
    orchestrator = new SubscriptionSagaOrchestrator(
      sagaModel,
      subscriptionModel as unknown as ISubscriptionModel,
      mockUow,
      logger,
      { attempts: 3, initialDelayMs: 0 },
    );
  });

  describe('onEmailSent', () => {
    it('marks the saga completed when it is in started status', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('started'));

      await orchestrator.onEmailSent(SAGA_ID);

      expect(sagaModel.markCompleted).toHaveBeenCalledWith(SAGA_ID, fakeTrx);
      expect(subscriptionModel.deleteById).not.toHaveBeenCalled();
    });

    it('is a no-op when the saga is already completed (idempotent)', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('completed'));

      await orchestrator.onEmailSent(SAGA_ID);

      expect(sagaModel.markCompleted).not.toHaveBeenCalled();
    });

    it('is a no-op when the saga is already compensated (idempotent)', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('compensated'));

      await orchestrator.onEmailSent(SAGA_ID);

      expect(sagaModel.markCompleted).not.toHaveBeenCalled();
    });

    it('warns and does nothing when the saga is not found', async () => {
      sagaModel.findById.mockResolvedValue(null);

      await orchestrator.onEmailSent(SAGA_ID);

      expect(sagaModel.markCompleted).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('onEmailFailed', () => {
    it('deletes the subscription and marks the saga compensated', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('started'));

      await orchestrator.onEmailFailed(SAGA_ID, 'smtp down');

      expect(subscriptionModel.deleteById).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        fakeTrx,
      );
      expect(sagaModel.markCompensated).toHaveBeenCalledWith(SAGA_ID, fakeTrx);
      expect(sagaModel.markCompleted).not.toHaveBeenCalled();
    });

    it('is a no-op when the saga is already compensated (idempotent)', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('compensated'));

      await orchestrator.onEmailFailed(SAGA_ID, 'smtp down');

      expect(subscriptionModel.deleteById).not.toHaveBeenCalled();
      expect(sagaModel.markCompensated).not.toHaveBeenCalled();
    });

    it('is a no-op when the saga is already completed (idempotent)', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('completed'));

      await orchestrator.onEmailFailed(SAGA_ID, 'smtp down');

      expect(subscriptionModel.deleteById).not.toHaveBeenCalled();
    });

    it('warns and does nothing when the saga is not found', async () => {
      sagaModel.findById.mockResolvedValue(null);

      await orchestrator.onEmailFailed(SAGA_ID, 'smtp down');

      expect(subscriptionModel.deleteById).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('both delete and markCompensated run inside the same UoW transaction', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('started'));

      await orchestrator.onEmailFailed(SAGA_ID, 'smtp down');

      expect(mockUow.run).toHaveBeenCalledTimes(1);
      // Both calls received the same fake transaction object
      expect(subscriptionModel.deleteById).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        fakeTrx,
      );
      expect(sagaModel.markCompensated).toHaveBeenCalledWith(SAGA_ID, fakeTrx);
    });
  });

  describe('retry on transient DB failures', () => {
    it('retries onEmailSent and succeeds on the second attempt', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('started'));
      mockUow.run
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockImplementation(
          async (work: (trx: Knex.Transaction) => Promise<unknown>) =>
            work(fakeTrx),
        );

      await orchestrator.onEmailSent(SAGA_ID);

      expect(mockUow.run).toHaveBeenCalledTimes(2);
      expect(sagaModel.markCompleted).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'saga.handler.retry' }),
        expect.any(String),
      );
    });

    it('retries onEmailFailed and succeeds on the second attempt', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('started'));
      mockUow.run
        .mockRejectedValueOnce(new Error('connection lost'))
        .mockImplementation(
          async (work: (trx: Knex.Transaction) => Promise<unknown>) =>
            work(fakeTrx),
        );

      await orchestrator.onEmailFailed(SAGA_ID, 'smtp down');

      expect(mockUow.run).toHaveBeenCalledTimes(2);
      expect(sagaModel.markCompensated).toHaveBeenCalledTimes(1);
    });

    it('throws after all retry attempts are exhausted', async () => {
      sagaModel.findById.mockResolvedValue(makeSagaRow('started'));
      mockUow.run.mockRejectedValue(new Error('DB permanently down'));

      await expect(orchestrator.onEmailSent(SAGA_ID)).rejects.toThrow(
        'DB permanently down',
      );
      expect(mockUow.run).toHaveBeenCalledTimes(3);
    });
  });
});
