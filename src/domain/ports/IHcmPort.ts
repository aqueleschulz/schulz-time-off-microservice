import {
  HcmBalanceDto,
  HcmDeductRequestDto,
  HcmDeductResponseDto,
  HcmBatchDto,
  HcmBatchResponseDto,
} from '../schemas';

/**
 * Outbound port establishing the contract for HCM API integrations.
 * * @example
 * const upstreamBalance = await hcmPort.getBalance('EMP_1', 'LOC_1');
 */
export interface IHcmPort {
  getBalance(
    targetEmployeeId: string,
    targetLocationId: string,
  ): Promise<HcmBalanceDto>;

  deductBalance(
    deductionRequestPayload: HcmDeductRequestDto,
    idempotencyLockKey: string,
  ): Promise<HcmDeductResponseDto>;

  processBatch(
    reconciliationBatchPayload: HcmBatchDto,
  ): Promise<HcmBatchResponseDto>;
}
