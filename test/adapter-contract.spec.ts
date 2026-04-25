import { HcmAdapter } from '../src/infrastructure/adapters/HcmAdapter';
import {
  InsufficientBalanceException,
  InvalidDimensionException,
  DependencyUnavailableException,
  HcmContractViolationException,
  CircuitBreakerOpenException,
  StaleBatchException,
} from '../src/domain/exceptions';

/**
 * Mocking the HTTP layer to isolate external I/O from the Adapter logic.
 */
class HttpClientMock {
  public nextResponse: unknown = null;
  public nextError: unknown = null;

  async post(): Promise<{ data: unknown }> {
    if (this.nextError) throw this.nextError;
    return { data: this.nextResponse };
  }

  async get(): Promise<{ data: unknown }> {
    if (this.nextError) throw this.nextError;
    return { data: this.nextResponse };
  }
}

describe('Adapter and Contract Integrity Validation', () => {
  let adapter: HcmAdapter;
  let httpMock: HttpClientMock;

  beforeEach(() => {
    httpMock = new HttpClientMock();
    // Injecting the mock bypassing strict typing for the constructor isolated test
    adapter = new HcmAdapter(httpMock as never);
  });

  it('Translates HTTP Unprocessable Entity into Insufficient Balance Exception', async () => {
    httpMock.nextError = {
      response: {
        status: 422,
        data: { error: 'BALANCE_TOO_LOW', code: 'ERR_402' },
      },
    };
    await expect(
      adapter.deductBalance({} as never, 'deduct-key'),
    ).rejects.toThrow(InsufficientBalanceException);
  });

  it('Translates HTTP Not Found into Invalid Dimension Exception', async () => {
    httpMock.nextError = {
      response: { status: 404, data: { error: 'LOCATION_NOT_FOUND' } },
    };
    await expect(adapter.deductBalance({} as never, 'dim-key')).rejects.toThrow(
      InvalidDimensionException,
    );
  });

  it('Translates Network Timeout into Dependency Unavailable Exception', async () => {
    httpMock.nextError = { code: 'ETIMEDOUT' };
    await expect(
      adapter.deductBalance({} as never, 'timeout-key'),
    ).rejects.toThrow(DependencyUnavailableException);
  });

  it('Validates Unexpected Response Schema Missing Required Fields', async () => {
    // Missing 'remainingBalance' field expected by the domain contract
    httpMock.nextResponse = { transactionId: 'tx-123' };
    await expect(
      adapter.deductBalance({} as never, 'schema-key'),
    ).rejects.toThrow(HcmContractViolationException);
  });

  it('Activates Circuit Breaker After Consecutive Failures Limit', async () => {
    httpMock.nextError = { code: 'ETIMEDOUT' };
    // Simulating consecutive connection drops
    for (let i = 0; i < 5; i++) {
      await adapter.deductBalance({} as never, `cb-key-${i}`).catch(() => {});
    }
    // The next attempt should fail fast without reaching the HTTP client
    await expect(
      adapter.deductBalance({} as never, 'cb-key-6'),
    ).rejects.toThrow(CircuitBreakerOpenException);
  });

  it('Validates Batch Payload Schema and Rejects Missing Dimensions', async () => {
    const invalidBatchPayload = {
      batchId: 'batch-01',
      balances: [{ employeeId: 'E1' }],
    };
    await expect(
      adapter.processBatch(invalidBatchPayload as never),
    ).rejects.toThrow(HcmContractViolationException);
  });

  it('Detects and Rejects Stale Batch Timestamps Older Than Local State', async () => {
    // Adapter must compare this generatedAt with the local persistence timestamp
    const staleBatchPayload = {
      batchId: 'batch-02',
      generatedAt: '2020-01-01T00:00:00Z',
      balances: [],
    };
    await expect(
      adapter.processBatch(staleBatchPayload as never),
    ).rejects.toThrow(StaleBatchException);
  });

  it('Handles Negative Balance Returned by HCM as the Absolute Source of Truth', async () => {
    httpMock.nextResponse = {
      balance: -5.0,
      employeeId: 'E1',
      locationId: 'L1',
    };
    const result = await adapter.getBalance('E1', 'L1');
    expect(result.balance).toBe(-5.0);
  });

  it('Processes Retry Logic Successfully After Transient Upstream Failure', async () => {
    httpMock.nextError = { response: { status: 500 } };
    const retryPromise = adapter.deductBalance({} as never, 'retry-key');

    // Simulating adapter internal retry success on the second attempt
    httpMock.nextError = null;
    httpMock.nextResponse = { status: 'SUCCESS', transactionId: 'tx-1' };

    await expect(retryPromise).resolves.toBeDefined();
  });

  it('Throws Contract Violation Exception Upon Receiving Malformed JSON', async () => {
    httpMock.nextResponse = 'invalid-json-string-without-braces';
    await expect(adapter.getBalance('E1', 'L1')).rejects.toThrow(
      HcmContractViolationException,
    );
  });
});
