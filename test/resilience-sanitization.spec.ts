import { TimeOffService } from '../src/domain/services/TimeOffService';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';
import { HcmDependencyUnavailableMock } from './mocks/HcmDependencyUnavailableMock';
import { InvalidDimensionException } from '../src/domain/exceptions';

describe('Resilience & Sanitization', () => {
  let service: TimeOffService;
  let mockHcm: HcmAdapterMock;
  let mockRepo: LocalBalanceRepositoryMock;

  beforeEach(() => {
    mockHcm = new HcmAdapterMock();
    mockRepo = new LocalBalanceRepositoryMock();
    service = new TimeOffService(mockHcm, mockRepo);
  });

  it('TRD-REQ: Fails Open on HCM Timeout if Local Balance is Sufficient', async () => {
    const outageHcmMock = new HcmDependencyUnavailableMock();
    const resilientService = new TimeOffService(outageHcmMock, mockRepo);

    mockRepo.seed('E1', 'L1', 10.0);
    const req = { employeeId: 'E1', locationId: 'L1', amount: 2.0, type: 'PTO'};

    const response = await resilientService.requestTimeOff(
      req,
      'fail-open-key',
    );

    expect(response.status).toBe('SUCCESS');
    expect(response.transactionId).toMatch(/^fail-open-/);

    expect(await mockRepo.getBalance('E1', 'L1')).toBe(8.0);
  });

  it('Negative Amount and Float Precision Error', async () => {
    mockRepo.seed('E4', 'L1', 10.0);
    mockHcm.seed('E4', 'L1', 10.0);

    const reqNeg = { employeeId: 'E4', locationId: 'L1', amount: -2.0, type: 'PTO'};
    await expect(service.requestTimeOff(reqNeg, 'e4-key-neg')).rejects.toThrow(
      InvalidDimensionException,
    );

    const reqFloat = { employeeId: 'E4', locationId: 'L1', amount: 0.0001, type: 'PTO'};
    await expect(
      service.requestTimeOff(reqFloat, 'e4-key-float'),
    ).rejects.toThrow(InvalidDimensionException);
  });

  it('Rejects Malformed Employee IDs', async () => {
    mockRepo.seed('E-5', 'L1', 10.0);
    mockHcm.seed('E-5', 'L1', 10.0);

    const reqMalformed = {
      employeeId: 'DROP TABLE EMPLOYEES',
      locationId: 'L1',
      amount: 1.0,
      type: 'PTO'
    };
    await expect(
      service.requestTimeOff(reqMalformed, 'sql-injection-key'),
    ).rejects.toThrow(InvalidDimensionException);
  });
});
