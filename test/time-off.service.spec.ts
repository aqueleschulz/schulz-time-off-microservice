import { TimeOffService } from '../src/domain/services/TimeOffService';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';
import {
  DependencyUnavailableException,
  InsufficientBalanceException,
} from '../src/domain/exceptions';

describe('TimeOffService - Critical Paths', () => {
  let service: TimeOffService;
  let mockHcm: HcmAdapterMock;
  let mockRepo: LocalBalanceRepositoryMock;

  beforeEach(() => {
    mockHcm = new HcmAdapterMock();
    mockRepo = new LocalBalanceRepositoryMock();
    service = new TimeOffService(mockHcm, mockRepo);
    mockRepo.seed('E123', 'L1', 10.0);
    mockHcm.seed('E123', 'L1', 10.0);
  });

  it('Duplicate Request with Identical Payload', async () => {
    const req = { employeeId: 'E123', locationId: 'L1', amount: 2.0 };
    const key = 'uuid-123';

    const res1 = await service.requestTimeOff(req, key);
    const res2 = await service.requestTimeOff(req, key);

    expect(res1.transactionId).toBe(res2.transactionId);
    expect(await mockRepo.getBalance('E123', 'L1')).toBe(8.0);
    expect(mockRepo.getAuditLogs()).toHaveLength(1);
  });

  it('Partial HCM Success (500 Error After Deduction)', async () => {
    mockHcm.setFailureMode('500_then_200');
    const req = { employeeId: 'E123', locationId: 'L1', amount: 3.0 };
    const key = 'uuid-500';

    await expect(service.requestTimeOff(req, key)).rejects.toThrow(
      DependencyUnavailableException,
    );

    const retryRes = await service.requestTimeOff(req, key);

    expect(retryRes.status).toBe('SUCCESS');
    expect(await mockRepo.getBalance('E123', 'L1')).toBe(7.0);
  });

  it('Local Cache Stale (HCM Granted Bonus)', async () => {
    mockRepo.seed('E123', 'L1', 0.0);
    mockHcm.seed('E123', 'L1', 0.0);
    mockHcm.grantBonus('E123', 'L1', 5.0);

    const req = { employeeId: 'E123', locationId: 'L1', amount: 2.0 };
    const res = await service.requestTimeOff(req, 'jit-1');

    expect(res.status).toBe('SUCCESS');
    expect(await mockRepo.getBalance('E123', 'L1')).toBe(3.0);
    expect(
      mockRepo.getAuditLogs().some((l) => l.actionType === 'JIT_HYDRATION'),
    ).toBeTruthy();
  });

  it('JIT Hydration Fails (HCM Timeout)', async () => {
    mockRepo.seed('E123', 'L1', 0.0);
    mockHcm.seed('E123', 'L1', 0.0);
    mockHcm.setFailureMode('timeout');

    const req = { employeeId: 'E123', locationId: 'L1', amount: 2.0 };

    await expect(service.requestTimeOff(req, 'jit-fail')).rejects.toThrow(
      DependencyUnavailableException,
    );
    expect(await mockRepo.getBalance('E123', 'L1')).toBe(0.0);
  });

  it('JIT Hydration Reveals Negative Balance', async () => {
    mockRepo.seed('E123', 'L1', 5.0);
    mockHcm.reset();
    mockHcm.seed('E123', 'L1', 0.0); // Reset forces sync strictly to zero
    mockHcm.grantBonus('E123', 'L1', -2.0);

    const req = { employeeId: 'E123', locationId: 'L1', amount: 1.0 };

    await expect(service.requestTimeOff(req, 'jit-neg')).rejects.toThrow(
      InsufficientBalanceException,
    );
    expect(await mockRepo.getBalance('E123', 'L1')).toBe(-2.0);
  });
});
