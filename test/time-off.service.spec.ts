import { TimeOffService } from '../src/domain/services/TimeOffService';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';
import { InsufficientBalanceException } from '../src/domain/exceptions';

describe('TimeOffService - Critical Paths', () => {
  let service: TimeOffService;
  let mockHcm: HcmAdapterMock;
  let mockRepo: LocalBalanceRepositoryMock;

  beforeEach(() => {
    mockHcm = new HcmAdapterMock();
    mockRepo = new LocalBalanceRepositoryMock();
    service = new TimeOffService(mockHcm, mockRepo);
  });

  it('TRD-REQ: JIT Hydration Prevents False Negatives', async () => {
    mockRepo.seed('E123', 'L1', 0.0);
    mockHcm.seed('E123', 'L1', 0.0);

    mockHcm.grantBonus('E123', 'L1', 5.0 * 1440);

    const timeOffRequest = {
      employeeId: 'E123',
      locationId: 'L1',
      amount: 2.0,
      type: 'PTO'
    };
    const response = await service.requestTimeOff(timeOffRequest, 'jit-lock-1');

    expect(response.status).toBe('SUCCESS');
    expect(await mockRepo.getBalance('E123', 'L1')).toBe(3.0);
  });

  it('TRD-REQ: Properly rejects when both Cache and HCM are insufficient', async () => {
    mockRepo.seed('E456', 'L1', 1.0);
    mockHcm.seed('E456', 'L1', 1.0);

    const timeOffRequest = {
      employeeId: 'E456',
      locationId: 'L1',
      amount: 2.0,
      type: 'PTO'
    };

    await expect(
      service.requestTimeOff(timeOffRequest, 'insufficient-lock'),
    ).rejects.toThrow(InsufficientBalanceException);
  });
});
