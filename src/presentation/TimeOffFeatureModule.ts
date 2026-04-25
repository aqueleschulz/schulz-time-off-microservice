import { Module } from '@nestjs/common';
import { TimeOffTransactionController } from './controllers/TimeOffTransactionController';
import { TimeOffService } from '../domain/services/TimeOffService';
import { IHcmPort } from '../domain/ports/IHcmPort';
import { IBalanceRepository } from '../domain/ports/IBalanceRepository';
import { DI_TOKENS } from '../infrastructure/di/InjectionTokens';
import { DefensiveDatabaseModule } from '../infrastructure/database/DefensiveDatabaseModule';
import { HcmIntegrationModule } from '../infrastructure/adapters/HcmIntegrationModule';

@Module({
  imports: [HcmIntegrationModule, DefensiveDatabaseModule],
  controllers: [TimeOffTransactionController],
  providers: [
    {
      provide: TimeOffService,
      useFactory: (hcm: IHcmPort, repo: IBalanceRepository) =>
        new TimeOffService(hcm, repo),
      inject: [DI_TOKENS.HCM_PORT, DI_TOKENS.BALANCE_REPOSITORY],
    },
  ],
  exports: [TimeOffService],
})
export class TimeOffFeatureModule {}
