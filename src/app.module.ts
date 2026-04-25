import { Module } from '@nestjs/common';
import { TimeOffFeatureModule } from './presentation/TimeOffFeatureModule';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TimeOffFeatureModule,
  ],
})
export class AppModule {}