import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TimeOffRequestDto,
  BatchPayloadDto,
  HcmBatchBalanceDto,
} from '../../domain/schemas';

export class TimeOffRequestPayload implements TimeOffRequestDto {
  @ApiProperty({
    example: 'EMP_123',
    description: 'Unique employee identifier',
  })
  @IsString()
  readonly employeeId: string;

  @ApiProperty({
    example: 'LOC_456',
    description: 'Unique location identifier',
  })
  @IsString()
  readonly locationId: string;

  @ApiProperty({ example: 2.0, description: 'Amount of days/hours to deduct' })
  @IsNumber()
  @IsPositive()
  readonly amount: number;
}

export class BatchBalanceItemPayload implements HcmBatchBalanceDto {
  @ApiProperty({ example: 'EMP_123' })
  @IsString()
  readonly employeeId: string;

  @ApiProperty({ example: 'LOC_456' })
  @IsString()
  readonly locationId: string;

  @ApiProperty({ example: 10.0 })
  @IsNumber()
  readonly balance: number;
}

export class SyncBatchPayload implements BatchPayloadDto {
  @ApiProperty({ example: 'batch_999' })
  @IsString()
  readonly batchId: string;

  @ApiProperty({ example: '2026-04-24T14:00:00Z' })
  @IsString()
  readonly generatedAt: string;

  @ApiProperty({ type: [BatchBalanceItemPayload] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceItemPayload)
  readonly balances: ReadonlyArray<BatchBalanceItemPayload>;
}
