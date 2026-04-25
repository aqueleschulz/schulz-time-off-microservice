import { Module } from '@nestjs/common';
import {
  TimeOffTransactionController,
  BatchReconciliationController,
} from './controllers/TimeOffTransactionController';
import { TimeOffService } from '../domain/services/TimeOffService';
import { IHcmPort } from '../domain/ports/IHcmPort';
import { IBalanceRepository } from '../domain/ports/IBalanceRepository';
import { DI_TOKENS } from '../infrastructure/di/InjectionTokens';
import { DefensiveDatabaseModule } from '../infrastructure/database/DefensiveDatabaseModule';
import { HcmIntegrationModule } from '../infrastructure/adapters/HcmIntegrationModule';

@Module({
  imports: [DefensiveDatabaseModule, HcmIntegrationModule],
  controllers: [TimeOffTransactionController, BatchReconciliationController],
  providers: [
    {
      provide: TimeOffService,
      useFactory: (hcmPort: IHcmPort, repository: IBalanceRepository) => {
        return new TimeOffService(hcmPort, repository);
      },
      inject: [DI_TOKENS.HCM_PORT, DI_TOKENS.BALANCE_REPOSITORY],
    },
  ],
})
export class TimeOffFeatureModule {}