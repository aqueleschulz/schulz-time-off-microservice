/**
 * DTOs defining the rigid contracts for external communication.
 * No generic un-typed objects are allowed crossing the domain boundary.
 */
export interface HcmBalanceDto {
  readonly employeeId: string;
  readonly locationId: string;
  readonly balance: number;
  readonly lastUpdated: string;
}

export interface HcmDeductRequestDto {
  readonly employeeId: string;
  readonly locationId: string;
  readonly amount: number;
}

export interface HcmDeductResponseDto {
  readonly transactionId: string;
  readonly remainingBalance: number;
  readonly status: 'SUCCESS' | 'PENDING' | 'FAILED';
}

export interface HcmBatchBalanceDto {
  readonly employeeId: string;
  readonly locationId: string;
  readonly balance: number;
}

export interface HcmBatchDto {
  readonly batchId: string;
  readonly generatedAt: string;
  readonly balances: ReadonlyArray<HcmBatchBalanceDto>;
}

export interface HcmBatchResultDto {
  readonly employeeId: string;
  readonly status: 'SUCCESS' | 'ERROR';
  readonly error?: string;
}

export interface HcmBatchResponseDto {
  readonly batchId: string;
  readonly processedCount: number;
  readonly errorCount: number;
  readonly results: ReadonlyArray<HcmBatchResultDto>;
}

export interface TimeOffRequestDto {
  readonly employeeId: string;
  readonly locationId: string;
  readonly amount: number;
}

export interface BatchPayloadDto extends HcmBatchDto {}