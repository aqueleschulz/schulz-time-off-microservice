import { IHcmPort } from '../../src/domain/ports/IHcmPort';
import { 
  HcmBalanceDto, 
  HcmDeductRequestDto, 
  HcmDeductResponseDto, 
  HcmBatchDto, 
  HcmBatchResponseDto 
} from '../../src/domain/schemas';
import { 
  HcmDimensionMismatchError, 
  HcmInsufficientBalanceError, 
  HcmServerError 
} from '../../src/domain/exceptions';

export type FailureMode = 'none' | 'timeout' | '500_once' | '500_always' | '500_then_200';

/**
 * Stateful Mock representing the upstream HCM API.
 */
export class HcmAdapterMock implements IHcmPort {
  private balances = new Map<string, { balance: number; lastUpdated: Date }>();
  private idempotencyRegistry = new Map<string, HcmDeductResponseDto>();
  private callHistory: string[] = [];
  private failureMode: FailureMode = 'none';

  constructor() { 
    this.seedInitialData(); 
  }

  // --- Test Helpers ---

  public reset(): void {
    this.balances.clear();
    this.idempotencyRegistry.clear();
    this.callHistory = [];
    this.failureMode = 'none';
    this.seedInitialData();
  }

  public grantBonus(employeeId: string, locationId: string, amount: number): void {
    const key = this.getMapKey(employeeId, locationId);
    const current = this.balances.get(key) || { balance: 0, lastUpdated: new Date() };
    this.balances.set(key, { balance: current.balance + amount, lastUpdated: new Date() });
  }

  public setFailureMode(mode: FailureMode): void {
    this.failureMode = mode;
  }

  public getCallCount(key: string): number {
    return this.callHistory.filter(k => k === key).length;
  }

  // --- IHcmPort Implementation ---

  public async getBalance(employeeId: string, locationId: string): Promise<HcmBalanceDto> {
    this.checkPreProcessingFailure();
    const key = this.getMapKey(employeeId, locationId);
    const ledger = this.balances.get(key);

    if (!ledger) throw new HcmDimensionMismatchError(`Dimension not found: ${key}`);

    return {
      employeeId, locationId,
      balance: ledger.balance,
      lastUpdated: ledger.lastUpdated.toISOString()
    };
  }

  public async deductBalance(req: HcmDeductRequestDto, key: string): Promise<HcmDeductResponseDto> {
    this.callHistory.push(key);

    if (this.idempotencyRegistry.has(key)) {
      return this.idempotencyRegistry.get(key)!; // Idempotent cache hit
    }

    this.checkPreProcessingFailure(key);
    const response = this.executeDeduction(req, key);
    
    // Critical: Throws AFTER deduction is internally recorded to simulate dropped connection
    this.checkPostProcessingFailure(key); 

    return response;
  }

  public async processBatch(payload: HcmBatchDto): Promise<HcmBatchResponseDto> {
    this.checkPreProcessingFailure();
    const results = payload.balances.map(item => this.updateBalanceFromBatch(item, payload.generatedAt));

    return {
      batchId: payload.batchId,
      processedCount: results.filter(r => r.status === 'SUCCESS').length,
      errorCount: results.filter(r => r.status === 'ERROR').length,
      results
    };
  }

  // --- Private Internal Logic ---

  private executeDeduction(req: HcmDeductRequestDto, key: string): HcmDeductResponseDto {
    const ledgerKey = this.getMapKey(req.employeeId, req.locationId);
    const ledger = this.balances.get(ledgerKey);

    if (!ledger || ledger.balance < req.amount) {
      throw new HcmInsufficientBalanceError('Insufficient funds in HCM');
    }

    ledger.balance -= req.amount;
    const response: HcmDeductResponseDto = { transactionId: `tx-${key}`, remainingBalance: ledger.balance, status: 'SUCCESS' };
    
    this.idempotencyRegistry.set(key, response);
    return response;
  }

  private updateBalanceFromBatch(item: HcmBalanceDto, generatedAt: string) {
    if (!item.employeeId || !item.locationId) {
      return { employeeId: item.employeeId || 'UNKNOWN', status: 'ERROR' };
    }
    
    this.balances.set(this.getMapKey(item.employeeId, item.locationId), {
      balance: item.balance,
      lastUpdated: new Date(generatedAt)
    });
    
    return { employeeId: item.employeeId, status: 'SUCCESS' };
  }

  private checkPreProcessingFailure(key?: string): void {
    const attempts = key ? this.getCallCount(key) : 1;
    if (this.failureMode === 'timeout') throw new Error('ETIMEDOUT');
    if (this.failureMode === '500_always') throw new HcmServerError('HCM 500');
    if (this.failureMode === '500_once' && attempts === 1) throw new HcmServerError('Transient HCM Failure');
  }

  private checkPostProcessingFailure(key: string): void {
    if (this.failureMode === '500_then_200' && this.getCallCount(key) === 1) {
      throw new HcmServerError('HCM Connection dropped after internal processing');
    }
  }

  private seedInitialData(): void {
    this.balances.set('E123::L1', { balance: 10.0, lastUpdated: new Date() });
    this.balances.set('E-TEST::L1', { balance: 50.0, lastUpdated: new Date() });
  }

  private getMapKey(employeeId: string, locationId: string): string {
    return `${employeeId}::${locationId}`;
  }
}