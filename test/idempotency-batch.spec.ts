import { TimeOffService } from '../src/domain/services/TimeOffService';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';

describe('Idempotency and Batch Concurrency', () => {
  let service: TimeOffService;
  let mockHcm: HcmAdapterMock;
  let mockRepo: LocalBalanceRepositoryMock;

  beforeEach(() => {
    mockHcm = new HcmAdapterMock();
    mockRepo = new LocalBalanceRepositoryMock();
    service = new TimeOffService(mockHcm, mockRepo);
  });

  it('Concurrent Requests with Different Keys for Same Employee', async () => {
    mockRepo.seed('EMP_X', 'LOC_1', 10.0);
    mockHcm.seed('EMP_X', 'LOC_1', 10.0);

    const req1 = service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 6.0, type: 'PTO' },
      'tx-key-alpha',
    );
    const req2 = service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 6.0, type: 'PTO' },
      'tx-key-beta',
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
    mockRepo.seed('EMP_X', 'LOC_1', 10.0);
    mockHcm.seed('EMP_X', 'LOC_1', 10.0);

    await service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 4.0, type: 'PTO'},
      'old-key',
    );

    const keyRecord = await mockRepo.getIdempotencyKey('old-key');
    if (keyRecord) {
      keyRecord.processedAt = new Date(Date.now() - 48 * 3600000);
      await mockRepo.saveIdempotencyKey(keyRecord);
    }

    await service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 4.0, type: 'PTO'},
      'old-key',
    );

    expect(await mockRepo.findBalance('EMP_X', 'LOC_1')).toMatchObject({
      amount: 2.0,
    });
  });

  it('Batch with One Thousand Employees under Concurrency', async () => {
    mockRepo.seed('EMP_X', 'LOC_1', 10.0);
    mockHcm.seed('EMP_X', 'LOC_1', 10.0);

    const balances = Array.from({ length: 1000 }).map((_, i) => ({
      employeeId: `BATCH_EMP_${i}`,
      locationId: 'LOC_1',
      balance: 15.0,
    }));

    const batchPromise = service.processBatchReconciliation({
      batchId: 'b1000',
      generatedAt: new Date().toISOString(),
      balances,
    });

    const concReq = service.requestTimeOff(
      { employeeId: 'EMP_X', locationId: 'LOC_1', amount: 1.0, type: 'PTO' },
      'conc-key',
    );

    await Promise.all([batchPromise, concReq]);

    expect(await mockRepo.findBalance('EMP_X', 'LOC_1')).toMatchObject({
      amount: 9.0,
    });
    expect(await mockRepo.findBalance('BATCH_EMP_999', 'LOC_1')).toMatchObject({
      amount: 15.0,
    });
  });
});
