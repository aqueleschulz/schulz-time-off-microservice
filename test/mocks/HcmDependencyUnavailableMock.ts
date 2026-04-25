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
    _employeeId: string,
    _locationId: string,
  ): Promise<HcmBalanceDto> {
    await Promise.resolve();
    return this.triggerSimulatedOutage();
  }

  public async deductBalance(
    _request: HcmDeductRequestDto,
    _lockKey: string,
  ): Promise<HcmDeductResponseDto> {
    await Promise.resolve();
    return this.triggerSimulatedOutage();
  }

  public async processBatch(_batch: HcmBatchDto): Promise<HcmBatchResponseDto> {
    await Promise.resolve();
    return this.triggerSimulatedOutage();
  }

  private triggerSimulatedOutage(): never {
    const simulatedError = new Error('ETIMEDOUT');
    simulatedError.name = 'TimeoutError';
    throw simulatedError;
  }
}
