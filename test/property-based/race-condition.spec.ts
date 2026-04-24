import fc from 'fast-check';
import { TimeOffService } from '../../src/domain/services/TimeOffService';
import { HcmAdapterMock } from '../mocks/HcmAdapterMock';
import { LocalBalanceRepositoryMock } from '../mocks/LocalBalanceRepositoryMock';

describe('Property-Based Tests', () => {
  it('Race Condition Detector for Concurrent Deductions', async () => {
    const mockRepo = new LocalBalanceRepositoryMock();
    const service = new TimeOffService(new HcmAdapterMock(), mockRepo);

    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.float({ min: 1, max: 5 }), { minLength: 10, maxLength: 100 }),
        async (amounts) => {
          const initialBalance = amounts.reduce((a, b) => a + b, 0);
          mockRepo.seed('E-PBT', 'L1', initialBalance);
          
          const promises = amounts.map((amt, i) => 
            service.requestTimeOff({ employeeId: 'E-PBT', locationId: 'L1', amount: amt }, `key-${i}`)
              .catch(e => ({ status: 'ERROR', error: e }))
          );
          
          const results = await Promise.all(promises);
          const approved = results.filter(r => r.status === 'SUCCESS');
          
          const finalBalance = await mockRepo.getBalance('E-PBT', 'L1');
          const totalDeducted = approved.reduce((sum, r: any) => sum + r.remainingBalance, 0);
          
          expect(finalBalance + totalDeducted).toBeCloseTo(initialBalance, 2);
          expect(finalBalance).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 50 }
    );
  });
});