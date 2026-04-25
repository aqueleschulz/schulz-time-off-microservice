import { TimeOffService } from '../src/domain/services/TimeOffService';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';
import {
  InvalidDimensionException,
  DependencyUnavailableException,
} from '../src/domain/exceptions';

describe('Resilience & Sanitization', () => {
  let service: TimeOffService;
  let mockHcm: HcmAdapterMock;
  let mockRepo: LocalBalanceRepositoryMock;

  beforeEach(() => {
    mockHcm = new HcmAdapterMock();
    mockRepo = new LocalBalanceRepositoryMock();
    service = new TimeOffService(mockHcm, mockRepo);
    mockRepo.seed('E1', 'L1', 10.0);
  });

  it('HCM Returns 500 on Deduction (Rollback)', async () => {
    mockHcm.setFailureMode('timeout');
    const req = { employeeId: 'E1', locationId: 'L1', amount: 2.0 };

    await expect(service.requestTimeOff(req, 'd1-key')).rejects.toThrow(
      DependencyUnavailableException,
    );
    expect(await mockRepo.getBalance('E1', 'L1')).toBe(10.0);
    expect(
      mockRepo
        .getAuditLogs()
        .some((l) => l.type === 'ROLLBACK_AFTER_HCM_FAILURE'),
    ).toBeTruthy();
  });

  it('Invalid EmployeeId Format (SQLi Defense)', async () => {
    const req = {
      employeeId: "'; DROP TABLE employees; --",
      locationId: 'L1',
      amount: 2.0,
    };

    await expect(service.requestTimeOff(req, 'e1-key')).rejects.toThrow(
      InvalidDimensionException,
    );
    expect(mockRepo.getAuditLogs()).toHaveLength(0);
  });

  it('Negative Amount and Float Precision Error', async () => {
    const reqNegative = { employeeId: 'E1', locationId: 'L1', amount: -5.0 };
    const reqFloat = { employeeId: 'E1', locationId: 'L1', amount: 0.123456 };

    await expect(service.requestTimeOff(reqNegative, 'e2-key')).rejects.toThrow(
      InvalidDimensionException,
    );
    await expect(service.requestTimeOff(reqFloat, 'e4-key')).rejects.toThrow(
      InvalidDimensionException,
    );
  });
});
