import { IHcmPort } from '../ports/IHcmPort';
import { IBalanceRepository } from '../ports/IBalanceRepository';
import {
  TimeOffRequestDto,
  HcmDeductResponseDto,
  BatchPayloadDto,
  HcmBatchResponseDto,
  HcmBatchResultDto,
  HcmBatchBalanceDto,
} from '../schemas';
import {
  InvalidDimensionException,
  InsufficientBalanceException,
  DependencyUnavailableException,
  CircuitBreakerOpenException,
  StaleBatchException,
} from '../exceptions';
import { Balance } from '../entities';

export class TimeOffService {
  private readonly MINUTES_IN_DAY = 1440;

  constructor(
    private readonly externalHcmPort: IHcmPort,
    private readonly localBalanceRepository: IBalanceRepository,
  ) {}

  // --- Strict Integer Mapping Converters ---
  private toMinutes(days: number): number {
    return Math.round(days * this.MINUTES_IN_DAY);
  }

  private toDays(minutes: number): number {
    return minutes / this.MINUTES_IN_DAY;
  }

  /**
   * Orchestrates the time-off request by validating, checking local state,
   * and attempting to synchronize with the HCM upstream.
   */
  public async requestTimeOff(
    timeOffRequest: TimeOffRequestDto,
    idempotencyLockKey: string,
  ): Promise<HcmDeductResponseDto> {
    this.validateRequestDimensions(timeOffRequest);

    const previouslyCachedResponse =
      await this.localBalanceRepository.getIdempotencyKey(idempotencyLockKey);
    if (previouslyCachedResponse?.responseStatus === 200) {
      return previouslyCachedResponse.responseBody as HcmDeductResponseDto;
    }

    return this.localBalanceRepository.executeSequentially(
      async (transactionalRepo) => {
        return this.executeAtomicDeduction(
          timeOffRequest,
          idempotencyLockKey,
          transactionalRepo,
        );
      },
    );
  }

  /**
   * Processes out-of-band updates from HCM using a delta calculation
   * to avoid overwriting in-flight transactions.
   */
  public async processBatchReconciliation(
    batch: BatchPayloadDto,
  ): Promise<HcmBatchResponseDto> {
    const results: HcmBatchResultDto[] = [];
    for (const item of batch.balances) {
      results.push(await this.handleSingleBatchItem(item, batch.generatedAt));
    }
    return {
      batchId: batch.batchId,
      processedCount: results.filter((r) => r.status === 'SUCCESS').length,
      errorCount: results.filter((r) => r.status === 'ERROR').length,
      results,
    };
  }

  public async getBalance(empId: string, locId: string): Promise<Balance> {
    const cached = await this.localBalanceRepository.findBalance(empId, locId);
    return (
      cached || {
        employeeId: empId,
        locationId: locId,
        amount: 0,
        lastSync: new Date(),
      }
    );
  }

  private async executeAtomicDeduction(
    req: TimeOffRequestDto,
    key: string,
    repo: IBalanceRepository,
  ): Promise<HcmDeductResponseDto> {
    const current = await this.guaranteeSufficientBalance(req, repo);

    // Strict Integer Math: (Current Minutes) - (Requested Minutes)
    const newBalanceMin =
      this.toMinutes(current.amount) - this.toMinutes(req.amount);
    const newBalanceDays = this.toDays(newBalanceMin);

    await repo.updateBalance(req.employeeId, req.locationId, newBalanceDays);
    await this.logLocalTransaction(req, 'LOCAL_DEDUCTION', req.amount, repo);

    try {
      const res = await this.externalHcmPort.deductBalance(req, key);
      await this.persistIdempotencyRecord(key, res, true, repo);
      return res;
    } catch (error) {
      return this.evaluateResilienceStrategy(error, key, repo);
    }
  }

  private async guaranteeSufficientBalance(
    req: TimeOffRequestDto,
    repo: IBalanceRepository,
  ): Promise<Balance> {
    let cached = await repo.findBalance(req.employeeId, req.locationId);

    if (!cached || this.toMinutes(cached.amount) < this.toMinutes(req.amount)) {
      const up = await this.externalHcmPort.getBalance(
        req.employeeId,
        req.locationId,
      );
      await repo.updateBalance(req.employeeId, req.locationId, up.balance);
      cached = {
        employeeId: req.employeeId,
        locationId: req.locationId,
        amount: up.balance,
        lastSync: new Date(),
      };
    }

    if (this.toMinutes(cached.amount) < this.toMinutes(req.amount)) {
      throw new InsufficientBalanceException(
        req.employeeId,
        req.locationId,
        req.amount,
        cached.amount,
      );
    }
    return cached;
  }

  private async evaluateResilienceStrategy(
    error: unknown,
    key: string,
    repo: IBalanceRepository,
  ): Promise<HcmDeductResponseDto> {
    if (this.isTransientNetworkFault(error)) {
      return this.executeFailOpen(key, repo);
    }
    throw error;
  }

  private isTransientNetworkFault(error: unknown): boolean {
    const isTimeout =
      error instanceof Error &&
      (error.message === 'ETIMEDOUT' || error.name === 'TimeoutError');
    return (
      isTimeout ||
      error instanceof DependencyUnavailableException ||
      error instanceof CircuitBreakerOpenException
    );
  }

  private async executeFailOpen(
    key: string,
    repo: IBalanceRepository,
  ): Promise<HcmDeductResponseDto> {
    const fallbackResponse: HcmDeductResponseDto = {
      status: 'SUCCESS',
      transactionId: `fail-open-${Date.now()}`,
      remainingBalance: 0, // Marker for unsynced state
    };
    await this.persistIdempotencyRecord(key, fallbackResponse, false, repo);
    return fallbackResponse;
  }

  private validateRequestDimensions(req: TimeOffRequestDto): void {
    const minutes = req.amount * this.MINUTES_IN_DAY;
    const hasInvalidPrecision = Math.abs(Math.round(minutes) - minutes) > 1e-6;

    if (req.amount <= 0 || hasInvalidPrecision) {
      throw new InvalidDimensionException('amount', String(req.amount));
    }
    if (!/^[a-zA-Z0-9-_]+$/.test(req.employeeId)) {
      throw new InvalidDimensionException('employeeId', req.employeeId);
    }
  }

  private async handleSingleBatchItem(
    item: HcmBatchBalanceDto,
    genAt: string,
  ): Promise<HcmBatchResultDto> {
    if (!item.employeeId || !item.locationId) {
      return {
        employeeId: item.employeeId as string, // Respeita o null que o teste envia
        status: 'ERROR',
        error: 'Missing dimensions',
      };
    }

    try {
      const cached = await this.localBalanceRepository.findBalance(
        item.employeeId,
        item.locationId,
      );
      if (cached && new Date(genAt) < cached.lastSync) {
        throw new StaleBatchException(genAt, cached.lastSync.toISOString());
      }
      await this.reconcileDelta(item, new Date(genAt));
      return { employeeId: item.employeeId, status: 'SUCCESS' };
    } catch (e) {
      if (e instanceof StaleBatchException) throw e;
      return {
        employeeId: item.employeeId,
        status: 'ERROR',
        error: e instanceof Error ? e.message : 'Unknown',
      };
    }
  }

  private async reconcileDelta(
    item: HcmBatchBalanceDto,
    batchDate: Date,
  ): Promise<void> {
    const pendingLogs =
      await this.localBalanceRepository.getPendingTransactions(
        item.employeeId,
        batchDate,
      );
    const pendingMinutes = pendingLogs.reduce(
      (acc, log) => acc + this.toMinutes(log.amount),
      0,
    );
    const finalMinutes = this.toMinutes(item.balance) - pendingMinutes;

    await this.localBalanceRepository.updateBalance(
      item.employeeId,
      item.locationId,
      this.toDays(finalMinutes),
    );
  }

  private async persistIdempotencyRecord(
    key: string,
    res: HcmDeductResponseDto,
    isSynced: boolean,
    repo: IBalanceRepository,
  ): Promise<void> {
    await repo.saveIdempotencyKey({
      key,
      processedAt: new Date(),
      responseStatus: 200,
      responseBody: res,
      internallyProcessed: isSynced,
    });
  }

  private async logLocalTransaction(
    req: TimeOffRequestDto,
    type: string,
    amount: number,
    repo: IBalanceRepository,
  ): Promise<void> {
    await repo.recordTransaction({
      transactionId: `tx-${Date.now()}`,
      employeeId: req.employeeId,
      locationId: req.locationId,
      amount,
      actionType: type,
      sourceSystem: 'ExampleHR',
      createdAt: new Date(),
    });
  }
}
