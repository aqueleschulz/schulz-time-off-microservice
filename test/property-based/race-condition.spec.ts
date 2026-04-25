import fc from 'fast-check';
import { TimeOffService } from '../../src/domain/services/TimeOffService';
import { HcmAdapterMock } from '../mocks/HcmAdapterMock';
import { LocalBalanceRepositoryMock } from '../mocks/LocalBalanceRepositoryMock';

describe('Property-Based Tests', () => {
  it('Race Condition Detector for Concurrent Deductions', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 5 }), {
          minLength: 10,
          maxLength: 100,
        }),
        async (amounts) => {
          const mockRepo = new LocalBalanceRepositoryMock();
          const mockHcm = new HcmAdapterMock();
          const service = new TimeOffService(mockHcm, mockRepo);

          const initialBalance = amounts.reduce((a, b) => a + b, 0);
          mockRepo.seed('E-PBT', 'L1', initialBalance);
          mockHcm.seed('E-PBT', 'L1', initialBalance);

          // Unique run ID guarantees idempotency keys never collide across parallel loops
          const runId = Math.random().toString(36).substring(7);

          const promises = amounts.map((amt, i) =>
            service
              .requestTimeOff(
                { employeeId: 'E-PBT', locationId: 'L1', amount: amt },
                `key-${runId}-${i}`,
              )
              .catch((e) => ({ status: 'ERROR', error: e })),
          );

          const results = await Promise.all(promises);

          const totalApprovedAmount = results.reduce(
            (sum, result, index) =>
              (result as any).status === 'SUCCESS' ? sum + amounts[index] : sum,
            0,
          );

          const finalBalance = await mockRepo.getBalance('E-PBT', 'L1');

          expect(finalBalance + totalApprovedAmount).toBeCloseTo(
            initialBalance,
            2,
          );
          expect(finalBalance).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 50 },
    );
  });
});
