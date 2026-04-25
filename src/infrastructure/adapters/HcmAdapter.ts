import CircuitBreaker from 'opossum';
import { z } from 'zod';
import { IHcmPort } from '../../domain/ports/IHcmPort';
import {
  HcmBalanceDto,
  HcmDeductRequestDto,
  HcmDeductResponseDto,
  HcmBatchDto,
  HcmBatchResponseDto,
} from '../../domain/schemas';
import {
  HcmBalanceResponseSchema,
  HcmDeductResponseSchema,
  HcmBatchPayloadSchema,
} from '../schemas';
import {
  InsufficientBalanceException,
  InvalidDimensionException,
  DependencyUnavailableException,
  HcmContractViolationException,
  CircuitBreakerOpenException,
  StaleBatchException,
} from '../../domain/exceptions';

export interface IHttpClient {
  get(endpointUrl: string): Promise<{ data: unknown }>;
  post(
    endpointUrl: string,
    requestPayload?: unknown,
    requestConfig?: unknown,
  ): Promise<{ data: unknown }>;
}

interface HcmErrorResponse {
  code?: string;
  response?: {
    status?: number;
    data?: { code?: string; error?: string };
  };
}

export class HcmAdapter implements IHcmPort {
  private circuitBreakerInstance: CircuitBreaker;

  constructor(private readonly nativeHttpClient: IHttpClient) {
    this.circuitBreakerInstance = new CircuitBreaker(
      this.executeHttpCall.bind(this),
      {
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        volumeThreshold: 5,
      },
    );
  }

  public async getBalance(
    targetEmployeeId: string,
    targetLocationId: string,
  ): Promise<HcmBalanceDto> {
    const fetchAction = () =>
      this.nativeHttpClient.get(
        `/hcm/balance?employeeId=${targetEmployeeId}&locationId=${targetLocationId}`,
      );
    const rawData = await this.dispatchWithResilience(fetchAction);
    const validatedData = this.enforceSchemaValidation(
      HcmBalanceResponseSchema,
      rawData,
    );

    return {
      employeeId: validatedData.employeeId,
      locationId: validatedData.locationId,
      balance: validatedData.balance,
      lastUpdated: validatedData.lastUpdated ?? new Date().toISOString(),
    };
  }

  public async deductBalance(
    deductionRequestPayload: HcmDeductRequestDto,
    idempotencyLockKey: string,
  ): Promise<HcmDeductResponseDto> {
    const postAction = () =>
      this.nativeHttpClient.post('/hcm/deduct', deductionRequestPayload, {
        headers: { 'Idempotency-Key': idempotencyLockKey },
      });
    const rawData = await this.dispatchWithResilience(postAction);
    return this.enforceSchemaValidation(HcmDeductResponseSchema, rawData);
  }

  public async processBatch(
    reconciliationBatchPayload: HcmBatchDto,
  ): Promise<HcmBatchResponseDto> {
    this.enforceSchemaValidation(
      HcmBatchPayloadSchema,
      reconciliationBatchPayload,
    );
    const STALE_BATCH_THRESHOLD = new Date('2025-01-01').getTime();

    if (
      new Date(reconciliationBatchPayload.generatedAt).getTime() <
      STALE_BATCH_THRESHOLD
    ) {
      throw new StaleBatchException(
        reconciliationBatchPayload.generatedAt,
        new Date().toISOString(),
      );
    }

    await this.dispatchWithResilience(() =>
      this.nativeHttpClient.post('/sync/batch', reconciliationBatchPayload),
    );

    return {
      batchId: reconciliationBatchPayload.batchId,
      processedCount: reconciliationBatchPayload.balances.length,
      errorCount: 0,
      results: [],
    };
  }

  private async executeHttpCall(
    httpAction: () => Promise<{ data: unknown }>,
  ): Promise<unknown> {
    const httpResponse = await httpAction();
    let responseData = httpResponse.data;

    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch (parseError) {
        throw { code: 'JSON_PARSE_ERROR' };
      }
    }
    return responseData;
  }

  private async dispatchWithResilience(
    httpAction: () => Promise<{ data: unknown }>,
  ): Promise<unknown> {
    const exponentialDelaysMs = [100, 200, 400];

    for (let currentAttempt = 0; currentAttempt < 3; currentAttempt++) {
      try {
        return await this.circuitBreakerInstance.fire(httpAction);
      } catch (caughtError: unknown) {
        await this.evaluateErrorAndRetry(
          caughtError,
          exponentialDelaysMs[currentAttempt],
          currentAttempt,
        );
      }
    }
    throw new DependencyUnavailableException('HCM', 'Max Retries Reached');
  }

  private async evaluateErrorAndRetry(
    caughtError: unknown,
    sleepDelayMs: number,
    currentAttempt: number,
  ): Promise<void> {
    if (!this.isValidErrorObject(caughtError))
      throw new DependencyUnavailableException('HCM', 'Invalid Error Format');

    if (caughtError.code === 'EOPENBREAKER')
      throw new CircuitBreakerOpenException('HCM');
    if (caughtError.code === 'JSON_PARSE_ERROR')
      throw new HcmContractViolationException('JSON_PARSE_ERROR');

    const httpStatus = caughtError.response?.status;
    const errorData = caughtError.response?.data;

    if (httpStatus === 422)
      throw new InsufficientBalanceException(
        errorData?.code || 'ERR',
        'N/A',
        0,
        0,
      );
    if (httpStatus === 404)
      throw new InvalidDimensionException(
        'locationId',
        errorData?.error || 'N/A',
      );
    if (currentAttempt === 2 || (httpStatus && httpStatus < 500))
      throw new DependencyUnavailableException('HCM', 'HTTP Error');

    await new Promise((resolve) => setTimeout(resolve, sleepDelayMs));
  }

  private isValidErrorObject(
    caughtError: unknown,
  ): caughtError is HcmErrorResponse {
    return typeof caughtError === 'object' && caughtError !== null;
  }

  private enforceSchemaValidation<T>(
    zodSchema: z.ZodType<T>,
    incomingData: unknown,
  ): T {
    const validationResult = zodSchema.safeParse(incomingData);
    if (!validationResult.success)
      throw new HcmContractViolationException(
        'Missing field or invalid schema',
      );
    return validationResult.data;
  }
}
