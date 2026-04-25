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
  StaleBatchException,
  CircuitBreakerOpenException,
} from '../exceptions';
import { Balance, TransactionAuditLog } from '../entities';

export class TimeOffService {
  private requestExecutionQueue = new Map<string, Promise<unknown>>();

  constructor(
    private readonly externalHcmPort: IHcmPort,
    private readonly localBalanceRepository: IBalanceRepository,
  ) {}

  /**
   * Processes a time-off request with idempotent guarantees and strict lock synchronization.
   * @example
   * const response = await service.requestTimeOff({ employeeId: 'E1', locationId: 'L1', amount: 8 }, 'uuid-123');
   */
  public async requestTimeOff(
    timeOffRequest: TimeOffRequestDto,
    idempotencyLockKey: string,
  ): Promise<HcmDeductResponseDto> {
    this.validateRequestDimensions(timeOffRequest);

    const concurrencyKey = `${timeOffRequest.employeeId}-${timeOffRequest.locationId}`;
    return this.enqueueSynchronizedExecution(concurrencyKey, async () => {
      const previouslyCachedResponse =
        await this.localBalanceRepository.getIdempotencyKey(idempotencyLockKey);

      if (previouslyCachedResponse?.responseStatus === 200) {
        return previouslyCachedResponse.responseBody as HcmDeductResponseDto;
      }

      return this.processDeductionLifecycle(timeOffRequest, idempotencyLockKey);
    });
  }

  /**
   * Retrieves the defensive local balance for immediate UI feedback.
   * @example
   * const balance = await service.getBalance('E1', 'L1');
   */
  public async getBalance(
    targetEmployeeId: string,
    targetLocationId: string,
  ): Promise<Balance> {
    const cachedBalance = await this.localBalanceRepository.findBalance(
      targetEmployeeId,
      targetLocationId,
    );
    return (
      cachedBalance || {
        employeeId: targetEmployeeId,
        locationId: targetLocationId,
        amount: 0,
        lastSync: new Date(),
      }
    );
  }

  /**
   * Reconciles out-of-band updates from the HCM batch engine without losing pending local deductions.
   * @example
   * const syncResult = await service.processBatchReconciliation(batchPayload);
   */
  public async processBatchReconciliation(
    reconciliationBatch: BatchPayloadDto,
  ): Promise<HcmBatchResponseDto> {
    const batchProcessingResults: HcmBatchResultDto[] = [];

    for (const batchItem of reconciliationBatch.balances) {
      const itemResult = await this.handleSingleBatchItem(
        batchItem,
        reconciliationBatch.generatedAt,
      );
      batchProcessingResults.push(itemResult);
    }

    const successfullyProcessedCount = batchProcessingResults.filter(
      (result) => result.status === 'SUCCESS',
    ).length;

    return {
      batchId: reconciliationBatch.batchId,
      processedCount: successfullyProcessedCount,
      errorCount: batchProcessingResults.length - successfullyProcessedCount,
      results: batchProcessingResults,
    };
  }

  // --- Private Business Logic ---

  private async enqueueSynchronizedExecution<T>(
    queueKey: string,
    executionCallback: () => Promise<T>,
  ): Promise<T> {
    const activePromise =
      this.requestExecutionQueue.get(queueKey) || Promise.resolve();
    const chainedExecution = activePromise
      .then(executionCallback)
      .catch((caughtError) => {
        throw caughtError;
      });

    this.requestExecutionQueue.set(
      queueKey,
      chainedExecution.catch(() => {}),
    );
    return chainedExecution as Promise<T>;
  }

  private validateRequestDimensions(timeOffRequest: TimeOffRequestDto): void {
    if (!timeOffRequest.locationId)
      throw new InvalidDimensionException('locationId', 'Missing locationId');
    if (timeOffRequest.amount <= 0)
      throw new InvalidDimensionException('amount', 'Amount must be positive');

    if (Math.abs((timeOffRequest.amount * 100) % 1) > 0.0001) {
      throw new InvalidDimensionException(
        'amount',
        'Exceeds decimal precision',
      );
    }

    if (!/^[a-zA-Z0-9-_]+$/.test(timeOffRequest.employeeId)) {
      throw new InvalidDimensionException('employeeId', 'Invalid format');
    }
  }

  private async processDeductionLifecycle(
    timeOffRequest: TimeOffRequestDto,
    idempotencyLockKey: string,
  ): Promise<HcmDeductResponseDto> {
    await this.guaranteeSufficientBalance(timeOffRequest);

    const originalBalanceState = await this.localBalanceRepository.findBalance(
      timeOffRequest.employeeId,
      timeOffRequest.locationId,
    );
    const originalAmountValue = originalBalanceState!.amount;

    await this.localBalanceRepository.updateBalance(
      timeOffRequest.employeeId,
      timeOffRequest.locationId,
      originalAmountValue - timeOffRequest.amount,
    );
    await this.logLocalTransaction(
      timeOffRequest,
      'LOCAL_DEDUCTION',
      timeOffRequest.amount,
    );

    try {
      const upstreamResponse = await this.externalHcmPort.deductBalance(
        timeOffRequest,
        idempotencyLockKey,
      );
      await this.persistIdempotencyState(
        idempotencyLockKey,
        upstreamResponse,
        true,
      );
      return upstreamResponse;
    } catch (upstreamFailure: unknown) {
      return this.handleDeductionFailure(
        upstreamFailure,
        timeOffRequest,
        originalAmountValue,
      );
    }
  }

  private async handleDeductionFailure(
    upstreamFailure: unknown,
    timeOffRequest: TimeOffRequestDto,
    originalAmountValue: number,
  ): Promise<never> {
    await this.rollbackFailedDeduction(timeOffRequest, originalAmountValue);

    if (this.isAvailabilityFault(upstreamFailure)) {
      throw new DependencyUnavailableException('HCM', 'deductBalance');
    }

    await this.resolveInsufficientBalanceDiscrepancy(
      upstreamFailure,
      timeOffRequest,
    );

    throw upstreamFailure;
  }

  private isAvailabilityFault(faultToEvaluate: unknown): boolean {
    if (faultToEvaluate instanceof DependencyUnavailableException) return true;
    if (faultToEvaluate instanceof CircuitBreakerOpenException) return true;
    if (
      faultToEvaluate instanceof Error &&
      faultToEvaluate.message === 'ETIMEDOUT'
    )
      return true;
    if (
      faultToEvaluate instanceof Error &&
      faultToEvaluate.name === 'HcmServerError'
    )
      return true;
    return false;
  }

  private async resolveInsufficientBalanceDiscrepancy(
    upstreamFailure: unknown,
    timeOffRequest: TimeOffRequestDto,
  ): Promise<void> {
    if (
      upstreamFailure instanceof Error &&
      upstreamFailure.name === 'HcmInsufficientBalanceError'
    ) {
      const trueUpstreamState = await this.externalHcmPort.getBalance(
        timeOffRequest.employeeId,
        timeOffRequest.locationId,
      );

      await this.localBalanceRepository.updateBalance(
        timeOffRequest.employeeId,
        timeOffRequest.locationId,
        trueUpstreamState.balance,
      );
      throw new InsufficientBalanceException(
        timeOffRequest.employeeId,
        timeOffRequest.locationId,
        timeOffRequest.amount,
        trueUpstreamState.balance,
      );
    }
  }

  private async guaranteeSufficientBalance(
    timeOffRequest: TimeOffRequestDto,
  ): Promise<void> {
    let currentCachedBalance = await this.localBalanceRepository.findBalance(
      timeOffRequest.employeeId,
      timeOffRequest.locationId,
    );

    if (
      !currentCachedBalance ||
      currentCachedBalance.amount < timeOffRequest.amount
    ) {
      currentCachedBalance = await this.executeJitHydration(timeOffRequest);
    }

    if (currentCachedBalance.amount < timeOffRequest.amount) {
      throw new InsufficientBalanceException(
        timeOffRequest.employeeId,
        timeOffRequest.locationId,
        timeOffRequest.amount,
        currentCachedBalance.amount,
      );
    }
  }

  private async executeJitHydration(
    timeOffRequest: TimeOffRequestDto,
  ): Promise<Balance> {
    const hydratedUpstreamData =
      await this.fetchUpstreamDataResiliently(timeOffRequest);

    // Persist truth unconditionally before validating
    await this.localBalanceRepository.updateBalance(
      timeOffRequest.employeeId,
      timeOffRequest.locationId,
      hydratedUpstreamData.balance,
    );
    await this.logLocalTransaction(
      timeOffRequest,
      'JIT_HYDRATION',
      hydratedUpstreamData.balance,
    );

    if (hydratedUpstreamData.balance < 0) {
      throw new InsufficientBalanceException(
        timeOffRequest.employeeId,
        timeOffRequest.locationId,
        timeOffRequest.amount,
        hydratedUpstreamData.balance,
      );
    }

    return {
      employeeId: timeOffRequest.employeeId,
      locationId: timeOffRequest.locationId,
      amount: hydratedUpstreamData.balance,
      lastSync: new Date(),
    };
  }

  private async fetchUpstreamDataResiliently(
    timeOffRequest: TimeOffRequestDto,
  ) {
    try {
      return await this.externalHcmPort.getBalance(
        timeOffRequest.employeeId,
        timeOffRequest.locationId,
      );
    } catch (fetchError: unknown) {
      if (fetchError instanceof Error && fetchError.message === 'ETIMEDOUT') {
        throw new DependencyUnavailableException('HCM', 'executeJitHydration');
      }
      throw fetchError;
    }
  }

  private async rollbackFailedDeduction(
    timeOffRequest: TimeOffRequestDto,
    originalAmountValue: number,
  ): Promise<void> {
    await this.localBalanceRepository.updateBalance(
      timeOffRequest.employeeId,
      timeOffRequest.locationId,
      originalAmountValue,
    );
    await this.logLocalTransaction(
      timeOffRequest,
      'ROLLBACK_AFTER_HCM_FAILURE',
      timeOffRequest.amount,
    );
  }

  private async persistIdempotencyState(
    idempotencyLockKey: string,
    upstreamResponse: HcmDeductResponseDto,
    wasInternallyProcessed: boolean,
  ): Promise<void> {
    await this.localBalanceRepository.saveIdempotencyKey({
      key: idempotencyLockKey,
      processedAt: new Date(),
      responseStatus: 200,
      responseBody: upstreamResponse,
      internallyProcessed: wasInternallyProcessed,
    });
  }

  private async handleSingleBatchItem(
    batchItem: HcmBatchBalanceDto,
    batchGeneratedAtString: string,
  ): Promise<HcmBatchResultDto> {
    if (!batchItem.employeeId || !batchItem.locationId) {
      return { employeeId: batchItem.employeeId, status: 'ERROR' };
    }

    try {
      const currentCachedRecord = await this.localBalanceRepository.findBalance(
        batchItem.employeeId,
        batchItem.locationId,
      );
      const batchGenerationTimestamp = new Date(batchGeneratedAtString);

      if (
        currentCachedRecord &&
        batchGenerationTimestamp < currentCachedRecord.lastSync
      ) {
        throw new StaleBatchException(
          batchGeneratedAtString,
          currentCachedRecord.lastSync.toISOString(),
        );
      }

      await this.applyReconciliationDelta(batchItem, batchGenerationTimestamp);
      return { employeeId: batchItem.employeeId, status: 'SUCCESS' };
    } catch (itemProcessingError) {
      // Prevents swallowing critical domain exceptions
      if (itemProcessingError instanceof StaleBatchException)
        throw itemProcessingError;
      return { employeeId: batchItem.employeeId, status: 'ERROR' };
    }
  }

  private async applyReconciliationDelta(
    batchItem: HcmBatchBalanceDto,
    batchGenerationTimestamp: Date,
  ): Promise<void> {
    const unacknowledgedPendingTransactions =
      await this.localBalanceRepository.getPendingTransactions(
        batchItem.employeeId,
        batchGenerationTimestamp,
      );

    const aggregatedPendingDeductions =
      unacknowledgedPendingTransactions.reduce(
        (accumulatedSum, auditLog) => accumulatedSum + auditLog.amount,
        0,
      );
    const reconciledEffectiveBalance =
      batchItem.balance - aggregatedPendingDeductions;

    await this.localBalanceRepository.updateBalance(
      batchItem.employeeId,
      batchItem.locationId,
      reconciledEffectiveBalance,
    );
    await this.logLocalTransaction(
      batchItem,
      'RECONCILED_VIA_BATCH',
      reconciledEffectiveBalance,
    );
  }

  private async logLocalTransaction(
    transactionDimensions: { employeeId?: string; locationId?: string },
    logActionType: string,
    transactedAmount: number,
  ): Promise<void> {
    await this.localBalanceRepository.recordTransaction({
      transactionId: `tx-${Date.now()}-${Math.random()}`,
      employeeId: transactionDimensions.employeeId || 'UNKNOWN',
      locationId: transactionDimensions.locationId || 'UNKNOWN',
      amount: transactedAmount,
      actionType: logActionType,
      sourceSystem: 'ExampleHR',
      createdAt: new Date(),
    });
  }
}
