import {
  HcmBalanceDto,
  HcmDeductRequestDto,
  HcmDeductResponseDto,
  HcmBatchDto,
  HcmBatchResponseDto,
  HcmBatchBalanceDto,
  HcmBatchResultDto,
} from '../../src/domain/schemas';
import {
  HcmDimensionMismatchError,
  HcmInsufficientBalanceError,
  HcmServerError,
} from '../../src/domain/exceptions';
import { IHcmPort } from '../../src/domain/ports/IHcmPort';

export type FailureMode =
  | 'none'
  | 'timeout'
  | '500_once'
  | '500_always'
  | '500_then_200';

export class HcmAdapterMock implements IHcmPort {
  private balances = new Map<string, { balance: number; lastUpdated: Date }>();
  private idempotencyRegistry = new Map<string, HcmDeductResponseDto>();
  private callHistory: string[] = [];
  private failureMode: FailureMode = 'none';

  public reset(): void {
    this.balances.clear();
    this.idempotencyRegistry.clear();
    this.callHistory = [];
    this.failureMode = 'none';
  }

  public seed(
    employeeId: string,
    locationId: string,
    amountInDays: number,
  ): void {
    this.balances.set(this.getMapKey(employeeId, locationId), {
      balance: Math.round(amountInDays * 1440),
      lastUpdated: new Date(),
    });
  }

  public grantBonus(
    employeeId: string,
    locationId: string,
    amount: number,
  ): void {
    const key = this.getMapKey(employeeId, locationId);
    const current = this.balances.get(key) || {
      balance: 0,
      lastUpdated: new Date(),
    };
    this.balances.set(key, {
      balance: current.balance + amount,
      lastUpdated: new Date(),
    });
  }

  public setFailureMode(mode: FailureMode): void {
    this.failureMode = mode;
  }

  public getCallCount(key: string): number {
    return this.callHistory.filter((k) => k === key).length;
  }

  public async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<HcmBalanceDto> {
    const ledger = this.balances.get(this.getMapKey(employeeId, locationId));
    if (!ledger) throw new Error('Dimension not found');
    return {
      employeeId,
      locationId,
      balance: ledger.balance / 1440,
      lastUpdated: ledger.lastUpdated.toISOString(),
    };
  }

  public async deductBalance(
    req: HcmDeductRequestDto,
    key: string,
  ): Promise<HcmDeductResponseDto> {
    this.callHistory.push(key);
    if (this.idempotencyRegistry.has(key))
      return this.idempotencyRegistry.get(key)!;

    this.checkPreProcessingFailure(key);
    const response = this.executeDeduction(req, key);
    this.checkPostProcessingFailure(key);

    return response;
  }

  public async processBatch(
    payload: HcmBatchDto,
  ): Promise<HcmBatchResponseDto> {
    this.checkPreProcessingFailure();
    const results: HcmBatchResultDto[] = payload.balances.map((item) =>
      this.updateBalanceFromBatch(item, payload.generatedAt),
    );

    return {
      batchId: payload.batchId,
      processedCount: results.filter((r) => r.status === 'SUCCESS').length,
      errorCount: results.filter((r) => r.status === 'ERROR').length,
      results,
    };
  }

  private executeDeduction(
    req: HcmDeductRequestDto,
    key: string,
  ): HcmDeductResponseDto {
    const ledgerKey = this.getMapKey(req.employeeId, req.locationId);
    const ledger = this.balances.get(ledgerKey);
    const requestInMinutes = Math.round(req.amount * 1440);

    if (!ledger || ledger.balance < requestInMinutes) {
      throw new HcmInsufficientBalanceError('Insufficient funds in HCM');
    }

    ledger.balance -= requestInMinutes;
    const response: HcmDeductResponseDto = {
      transactionId: `tx-${key}`,
      remainingBalance: ledger.balance / 1440,
      status: 'SUCCESS',
    };

    this.idempotencyRegistry.set(key, response);
    return response;
  }

  private updateBalanceFromBatch(
    item: HcmBatchBalanceDto,
    generatedAt: string,
  ): HcmBatchResultDto {
    if (!item.employeeId || !item.locationId) {
      return {
        employeeId: item.employeeId as string, // Let it be null for the tests
        status: 'ERROR',
        error: 'Missing dimensions',
      };
    }
    this.balances.set(this.getMapKey(item.employeeId, item.locationId), {
      balance: item.balance,
      lastUpdated: new Date(generatedAt),
    });
    return { employeeId: item.employeeId, status: 'SUCCESS' };
  }

  private checkPreProcessingFailure(key?: string): void {
    const attempts = key ? this.getCallCount(key) : 1;
    if (this.failureMode === 'timeout') throw new Error('ETIMEDOUT');
    if (this.failureMode === '500_always') throw new HcmServerError('HCM 500');
    if (this.failureMode === '500_once' && attempts === 1)
      throw new HcmServerError('Transient HCM Failure');
  }

  private checkPostProcessingFailure(key: string): void {
    if (this.failureMode === '500_then_200' && this.getCallCount(key) === 1) {
      throw new HcmServerError(
        'HCM Connection dropped after internal processing',
      );
    }
  }

  private getMapKey(employeeId: string, locationId: string): string {
    return `${employeeId}::${locationId}`;
  }
}
