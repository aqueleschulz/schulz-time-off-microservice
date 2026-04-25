import {
  HcmBalanceDto,
  HcmDeductRequestDto,
  HcmDeductResponseDto,
  HcmBatchDto,
  HcmBatchResponseDto,
} from '../schemas';

/**
 * Outbound port establishing the contract for HCM API integrations.
 * @example
 * const balance = await hcmPort.getBalance('EMP_1', 'LOC_1');
 */
export interface IHcmPort {
  getBalance(employeeId: string, locationId: string): Promise<HcmBalanceDto>;
  deductBalance(
    request: HcmDeductRequestDto,
    idempotencyKey: string,
  ): Promise<HcmDeductResponseDto>;
  processBatch(payload: HcmBatchDto): Promise<HcmBatchResponseDto>;
}
