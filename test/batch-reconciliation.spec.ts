import { TimeOffService } from '../src/domain/services/TimeOffService';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';
import { StaleBatchException } from '../src/domain/exceptions';

describe('Batch Reconciliation', () => {
  let service: TimeOffService;
  let mockRepo: LocalBalanceRepositoryMock;

  beforeEach(() => {
    mockRepo = new LocalBalanceRepositoryMock();
    service = new TimeOffService(new HcmAdapterMock(), mockRepo);
  });

  it('In-Flight Transaction During Batch', async () => {
    mockRepo.seed('E1', 'L1', 10.0, new Date('2026-04-24T14:00:00Z'));

    mockRepo.addAuditLog({
      employeeId: 'E1',
      locationId: 'L1',
      amount: 3.0,
      actionType: 'PENDING_HCM_ACK',
      sourceSystem: 'ExampleHR',
      createdAt: new Date('2026-04-24T14:05:00Z'),
    });

    const batch = {
      batchId: 'b1',
      generatedAt: '2026-04-24T14:00:00Z',
      balances: [{ employeeId: 'E1', locationId: 'L1', balance: 10.0 }],
    };

    await service.processBatchReconciliation(batch);
    expect(await mockRepo.getBalance('E1', 'L1')).toBe(7.0);
  });

  it('Batch with Invalid Data (Multi-Status)', async () => {
    const batch = {
      batchId: 'b2',
      generatedAt: new Date().toISOString(),
      balances: [
        { employeeId: 'E1', locationId: 'L1', balance: 10.0 },
        {
          employeeId: null as unknown as string,
          locationId: 'L2',
          balance: 5.0,
        },
      ],
    };

    const result = await service.processBatchReconciliation(batch);
    expect(result.results.find((r) => r.employeeId === 'E1')?.status).toBe(
      'SUCCESS',
    );
    expect(result.results.find((r) => !r.employeeId)?.status).toBe('ERROR');
  });

  it('Batch Out-of-Order Arrival', async () => {
    mockRepo.seed('E1', 'L1', 10.0, new Date('2026-04-24T14:00:00Z'));

    const staleBatch = {
      batchId: 'b3',
      generatedAt: '2026-04-24T13:00:00Z',
      balances: [{ employeeId: 'E1', locationId: 'L1', balance: 15.0 }],
    };

    await expect(
      service.processBatchReconciliation(staleBatch),
    ).rejects.toThrow(StaleBatchException);
  });
});
