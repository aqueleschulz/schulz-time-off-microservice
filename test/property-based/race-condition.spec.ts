import fc from 'fast-check';
import { TimeOffService } from '../../src/domain/services/TimeOffService';
import { LocalBalanceRepositoryMock } from '../mocks/LocalBalanceRepositoryMock';
import { HcmAdapterMock } from '../mocks/HcmAdapterMock';

describe('Property-Based Invariants - TimeOffService', () => {
  it('PBT: Floating Point Precision Invariant (Exposes JS Math Drift)', async () => {
    const mathPrecisionProperty = fc.asyncProperty(
      fc.integer({ min: 144, max: 1296 }).map((m) => m / 1440),
      fc.integer({ min: 144, max: 1296 }).map((m) => m / 1440),
      async (initialFraction, deductionFraction) => {
        const repoMock = new LocalBalanceRepositoryMock();
        const hcmMock = new HcmAdapterMock();
        const service = new TimeOffService(hcmMock, repoMock);

        const initialBalance = 10.0 + initialFraction;
        repoMock.seed('E-MATH', 'L1', initialBalance);
        hcmMock.seed('E-MATH', 'L1', initialBalance);

        await service.requestTimeOff(
          { employeeId: 'E-MATH', locationId: 'L1', amount: deductionFraction, type: 'PTO' },
          `lock-${Date.now()}`,
        );

        const finalBalance = await repoMock.getBalance('E-MATH', 'L1');
        const expectedExactBalance =
          (initialBalance * 1000 - deductionFraction * 1000) / 1000;

        expect(finalBalance).toBeCloseTo(expectedExactBalance, 4);
      },
    );

    await fc.assert(mathPrecisionProperty, { numRuns: 100 });
  });

  it('PBT: Concurrent Memory Lock Bypass (Exposes lack of DB Transactions)', async () => {
    const repoMock = new LocalBalanceRepositoryMock();
    const hcmMock = new HcmAdapterMock();
    const service = new TimeOffService(hcmMock, repoMock);

    repoMock.seed('E-RACE', 'L1', 100.0);
    hcmMock.seed('E-RACE', 'L1', 100.0);

    const concurrentRequests = Array.from({ length: 50 }).map((_, index) =>
      service.requestTimeOff(
        { employeeId: 'E-RACE', locationId: 'L1', amount: 1.0, type: 'PTO' },
        `race-lock-${index}`,
      ),
    );

    await Promise.allSettled(concurrentRequests);

    const finalBalance = await repoMock.getBalance('E-RACE', 'L1');
    const logs = repoMock
      .getAuditLogs()
      .filter((l) => l.actionType === 'LOCAL_DEDUCTION');

    expect(logs).toHaveLength(50);
    expect(finalBalance).toBe(50.0);
  });
});
