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
        // While testing, uses memory. If not testing, uses docker path or default
        const dbPath = process.env.NODE_ENV === 'test' 
          ? ':memory:' 
          : (process.env.DATABASE_URL?.replace('file:', '') || 'sqlite.db');
          
        const sqlite = new Database(dbPath);
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
