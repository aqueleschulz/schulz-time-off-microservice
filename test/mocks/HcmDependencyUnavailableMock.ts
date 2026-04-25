import { IHcmPort } from '../../src/domain/ports/IHcmPort';
import {
  HcmBalanceDto,
  HcmDeductRequestDto,
  HcmDeductResponseDto,
  HcmBatchDto,
  HcmBatchResponseDto,
} from '../../src/domain/schemas';

/**
 * Simulates a catastrophic upstream failure (e.g., ETIMEDOUT or 503) to validate Fail Open policies.
 * @example
 * const hcmMock = new HcmDependencyUnavailableMock();
 * const service = new TimeOffService(hcmMock, localRepo);
 */
export class HcmDependencyUnavailableMock implements IHcmPort {
  public async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<HcmBalanceDto> {
    return this.triggerSimulatedOutage();
  }

  public async deductBalance(
    request: HcmDeductRequestDto,
    lockKey: string,
  ): Promise<HcmDeductResponseDto> {
    return this.triggerSimulatedOutage();
  }

  public async processBatch(batch: HcmBatchDto): Promise<HcmBatchResponseDto> {
    return this.triggerSimulatedOutage();
  }

  private triggerSimulatedOutage(): never {
    const simulatedError = new Error('ETIMEDOUT');
    simulatedError.name = 'TimeoutError';
    throw simulatedError;
  }
}
