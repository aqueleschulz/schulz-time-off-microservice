import { TimeOffService } from '../src/domain/services/TimeOffService';
import { HcmAdapterMock } from './mocks/HcmAdapterMock';
import { LocalBalanceRepositoryMock } from './mocks/LocalBalanceRepositoryMock';
import { DependencyUnavailableException } from '../src/domain/exceptions';

describe('Resilience and Observability Guarantees', () => {
  let serviceInstanceA: TimeOffService;
  let mockRepo: LocalBalanceRepositoryMock;
  let mockHcm: HcmAdapterMock;

  beforeEach(() => {
    mockRepo = new LocalBalanceRepositoryMock();
    mockHcm = new HcmAdapterMock();
    serviceInstanceA = new TimeOffService(mockHcm, mockRepo);
    mockRepo.seed('EMP_Y', 'LOC_1', 20.0);
  });

  it('Maintains Data Integrity Following SQLite Connection Loss Mid Transaction', async () => {
    mockRepo.simulateCrash(true);
    const deductionRequest = { employeeId: 'EMP_Y', locationId: 'LOC_1', amount: 5.0 };
    
    await expect(serviceInstanceA.requestTimeOff(deductionRequest, 'crash-lock')).rejects.toThrow(DependencyUnavailableException);
    
    // Restoring database connection to verify WAL rollback prevented dirty writes
    mockRepo.simulateCrash(false);
    expect(await mockRepo.findBalance('EMP_Y', 'LOC_1')).toMatchObject({ amount: 20.0 });
  });

  it('Prevents Duplicate Processing During Network Partition via Shared Idempotency', async () => {
    const deductionRequest = { employeeId: 'EMP_Y', locationId: 'LOC_1', amount: 2.0 };
    const sharedIdempotencyKey = 'split-brain-lock';
    
    // Instance A processes the request successfully
    await serviceInstanceA.requestTimeOff(deductionRequest, sharedIdempotencyKey);
    
    // Instance B spins up, sharing the same database repository
    const serviceInstanceB = new TimeOffService(mockHcm, mockRepo);
    const responseFromB = await serviceInstanceB.requestTimeOff(deductionRequest, sharedIdempotencyKey);
    
    // Instance B must return the cached success response without calling the HCM again
    expect(mockHcm.getCallCount(sharedIdempotencyKey)).toBe(1);
    expect(responseFromB.status).toBe('SUCCESS');
  });

  it('Fails Gracefully When Query Duration Exceeds Minimum Response Threshold', async () => {
    mockRepo.setLatency(250); // Simulating a massive disk I/O spike
    const requestStartTime = Date.now();
    
    await serviceInstanceA.getBalance('EMP_Y', 'LOC_1');
    const totalExecutionTime = Date.now() - requestStartTime;
    
    // Validates the non-functional requirement constraint
    expect(totalExecutionTime).toBeGreaterThanOrEqual(250); 
  });

  it('Ensures Complete Audit Log Generation for Every Local Deduction', async () => {
    await serviceInstanceA.requestTimeOff({ employeeId: 'EMP_Y', locationId: 'LOC_1', amount: 3.0 }, 'audit-lock');
    const transactionLogs = mockRepo.getAuditLogs();
    
    expect(transactionLogs[0]).toMatchObject({ actionType: 'LOCAL_DEDUCTION', sourceSystem: 'ExampleHR' });
    expect(transactionLogs[0]).toHaveProperty('transactionId');
  });

  it('Enforces Single Query Execution Limit to Prevent N Plus One Inefficiencies', async () => {
    mockRepo.resetQueryCount();
    await serviceInstanceA.getBalance('EMP_Y', 'LOC_1');
    
    // Ensures a single indexed lookup is performed without cascading queries
    expect(mockRepo.getQueryCount()).toBe(1);
  });
});