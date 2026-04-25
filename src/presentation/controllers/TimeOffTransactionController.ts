import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiHeader, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TimeOffService } from '../../domain/services/TimeOffService';
import {
  TimeOffRequestPayload,
  SyncBatchPayload,
} from '../dtos/TimeOffApiDtos';

@ApiTags('Time-Off Transactions')
@Controller('time-off')
export class TimeOffTransactionController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Request time off with idempotent deduction' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID for retry safety',
  })
  @ApiResponse({ status: 200, description: 'Deduction approved successfully' })
  public async executeDeductionRequest(
    @Body() payload: TimeOffRequestPayload,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    const domainResponse = await this.timeOffService.requestTimeOff(
      payload,
      idempotencyKey,
    );

    return {
      status:
        domainResponse.status === 'SUCCESS'
          ? 'APPROVED'
          : domainResponse.status,
      transactionId: domainResponse.transactionId,
      updatedLocalBalance: domainResponse.remainingBalance,
      hcmSyncStatus: domainResponse.transactionId.startsWith('fail-open')
        ? 'UNSYNCED'
        : 'SYNCED',
    };
  }

  @Get('balance')
  @ApiOperation({ summary: 'Retrieve defensive local balance' })
  public async fetchLocalBalance(
    @Query('employeeId') employeeId: string,
    @Query('locationId') locationId: string,
  ) {
    return this.timeOffService.getBalance(employeeId, locationId);
  }
}

@ApiTags('HCM Synchronization')
@Controller('sync')
export class BatchReconciliationController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post('batch')
  @HttpCode(HttpStatus.MULTI_STATUS) // 207 Multi-Status strictly required by Test C3
  @ApiOperation({ summary: 'Process out-of-band HCM batch updates' })
  public async processHcmBatch(@Body() payload: SyncBatchPayload) {
    return this.timeOffService.processBatchReconciliation(payload);
  }
}
