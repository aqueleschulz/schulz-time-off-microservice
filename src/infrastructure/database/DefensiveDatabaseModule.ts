import { Module, Global } from '@nestjs/common';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DI_TOKENS } from '../di/InjectionTokens';
import { SqliteDefensiveRepository } from '../repositories/SqliteDefensiveRepository';
import * as schema from './DrizzleSchema';

@Global()
@Module({
  providers: [
    {
      provide: DI_TOKENS.DB_CONNECTION,
      useFactory: () => {
        // In-memory strictly for isolated tests, or file based for runtime
        const sqlite = new Database(
          process.env.NODE_ENV === 'test' ? ':memory:' : 'sqlite.db',
        );
        return drizzle(sqlite, { schema });
      },
    },
    {
      provide: DI_TOKENS.BALANCE_REPOSITORY,
      useClass: SqliteDefensiveRepository,
    },
  ],
  exports: [DI_TOKENS.BALANCE_REPOSITORY],
})
export class DefensiveDatabaseModule {}
