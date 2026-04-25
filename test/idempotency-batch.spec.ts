import { TimeOffService } from '../src/domain/services/TimeOffService';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';

describe('Idempotency and Batch Concurrency', () => {
  let service: TimeOffService;
  let mockRepo: LocalBalanceRepositoryMock;

  beforeEach(() => {
    mockRepo = new LocalBalanceRepositoryMock();
    service = new TimeOffService(new HcmAdapterMock(), mockRepo);
    mockRepo.seed('EMP_X', 'LOC_1', 10.0);
  });

  it('Concurrent Requests with Different Keys for Same Employee', async () => {
    const req1 = service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 6.0 },
      'key-alpha',
    );
    const req2 = service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 6.0 },
      'key-beta',
    );

    const results = await Promise.allSettled([req1, req2]);
    const approved = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(approved).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(await mockRepo.findBalance('EMP_X', 'LOC_1')).toMatchObject({
      amount: 4.0,
    });
  });

  it('Idempotency Key Expiration', async () => {
    await service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 2.0 },
      'old-key',
    );

    const record = await mockRepo.getIdempotencyKey('old-key');
    if (record) record.processedAt = new Date(Date.now() - 25 * 3600000);

    const res = await service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 2.0 },
      'old-key',
    );
    expect(await mockRepo.findBalance('EMP_X', 'LOC_1')).toMatchObject({
      amount: 6.0,
    });
  });

  it('Batch with One Thousand Employees under Concurrency', async () => {
    const batchBalances = Array.from({ length: 1000 }).map((_, i) => ({
      employeeId: `BATCH_EMP_${i}`,
      locationId: 'LOC_1',
      balance: 10.0,
    }));

    const batchPromise = service.processBatchReconciliation({
      batchId: 'B1',
      generatedAt: new Date().toISOString(),
      balances: batchBalances,
    });
    const concReq = service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 1.0 },
      'conc-key',
    );

    await Promise.all([batchPromise, concReq]);

    expect(await mockRepo.findBalance('EMP_X', 'LOC_1')).toMatchObject({
      amount: 9.0,
    });
    expect(await mockRepo.findBalance('BATCH_EMP_999', 'LOC_1')).toMatchObject({
      amount: 10.0,
    });
  });
});
