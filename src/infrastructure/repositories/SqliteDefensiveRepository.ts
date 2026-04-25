import { Injectable, Inject } from '@nestjs/common';
import { eq, and, gt } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { randomUUID } from 'crypto';
import { IBalanceRepository } from '../../domain/ports/IBalanceRepository';
import {
  Balance,
  TransactionAuditLog,
  IdempotencyRecord,
} from '../../domain/entities';
import * as schema from '../database/DrizzleSchema';
import { DI_TOKENS } from '../di/InjectionTokens';
import { DependencyUnavailableException } from '../../domain/exceptions';

@Injectable()
export class SqliteDefensiveRepository implements IBalanceRepository {
  constructor(
    @Inject(DI_TOKENS.DB_CONNECTION)
    private readonly dbConnection: BetterSQLite3Database<typeof schema>,
  ) {}

  public async findBalance(
    targetEmployeeId: string,
    targetLocationId: string,
  ): Promise<Balance | null> {
    return this.executeWithResilience('findBalance', async () => {
      const records = await this.dbConnection
        .select()
        .from(schema.timeOffBalancesTable)
        .where(
          and(
            eq(schema.timeOffBalancesTable.employeeId, targetEmployeeId),
            eq(schema.timeOffBalancesTable.locationId, targetLocationId),
          ),
        )
        .limit(1);
      return records[0] || null;
    });
  }

  public async updateBalance(
    targetEmployeeId: string,
    targetLocationId: string,
    newBalanceAmount: number,
  ): Promise<void> {
    return this.executeWithResilience('updateBalance', async () => {
      const existingRecord = await this.findBalance(
        targetEmployeeId,
        targetLocationId,
      );
      const synchronizationTime = new Date();

      if (existingRecord) {
        await this.dbConnection
          .update(schema.timeOffBalancesTable)
          .set({ amount: newBalanceAmount, lastSync: synchronizationTime })
          .where(
            and(
              eq(schema.timeOffBalancesTable.employeeId, targetEmployeeId),
              eq(schema.timeOffBalancesTable.locationId, targetLocationId),
            ),
          );
        return;
      }

      await this.dbConnection.insert(schema.timeOffBalancesTable).values({
        id: randomUUID(),
        employeeId: targetEmployeeId,
        locationId: targetLocationId,
        amount: newBalanceAmount,
        lastSync: synchronizationTime,
      });
    });
  }

  public async recordTransaction(
    auditLogEntry: TransactionAuditLog,
  ): Promise<void> {
    return this.executeWithResilience('recordTransaction', async () => {
      await this.dbConnection.insert(schema.transactionAuditLogsTable).values({
        id: randomUUID(),
        transactionId: auditLogEntry.transactionId || null,
        employeeId: auditLogEntry.employeeId,
        locationId: auditLogEntry.locationId,
        amount: auditLogEntry.amount,
        actionType: auditLogEntry.actionType,
        sourceSystem: auditLogEntry.sourceSystem,
        createdAt: auditLogEntry.createdAt,
      });
    });
  }

  public async saveIdempotencyKey(
    idempotencyRecord: IdempotencyRecord,
  ): Promise<void> {
    return this.executeWithResilience('saveIdempotencyKey', async () => {
      await this.dbConnection.insert(schema.idempotencyKeysTable).values({
        key: idempotencyRecord.key,
        requestPayload: idempotencyRecord.requestPayload,
        responseStatus: idempotencyRecord.responseStatus || null,
        responseBody: idempotencyRecord.responseBody,
        processedAt: idempotencyRecord.processedAt,
        internallyProcessed: idempotencyRecord.internallyProcessed || false,
      });
    });
  }

  public async getIdempotencyKey(
    uniqueIdempotencyKey: string,
  ): Promise<IdempotencyRecord | null> {
    return this.executeWithResilience('getIdempotencyKey', async () => {
      const records = await this.dbConnection
        .select()
        .from(schema.idempotencyKeysTable)
        .where(eq(schema.idempotencyKeysTable.key, uniqueIdempotencyKey))
        .limit(1);

      if (!records[0]) return null;

      const IDEMPOTENCY_KEY_TTL_HOURS = 24;
      const ageInHours =
        (Date.now() - records[0].processedAt.getTime()) / 3600000;

      return ageInHours > IDEMPOTENCY_KEY_TTL_HOURS
        ? null
        : (records[0] as IdempotencyRecord);
    });
  }

  public async getPendingTransactions(
    targetEmployeeId: string,
    sinceTimestamp: Date,
  ): Promise<TransactionAuditLog[]> {
    return this.executeWithResilience('getPendingTransactions', async () => {
      const records = await this.dbConnection
        .select()
        .from(schema.transactionAuditLogsTable)
        .where(
          and(
            eq(schema.transactionAuditLogsTable.employeeId, targetEmployeeId),
            gt(schema.transactionAuditLogsTable.createdAt, sinceTimestamp),
          ),
        );

      return records.filter(
        (r) => r.actionType === 'PENDING_HCM_ACK',
      ) as TransactionAuditLog[];
    });
  }

  // Intercepta falhas brutas do Drizzle/SQLite e traduz para exceções de Domínio (Alvo B2)
  private async executeWithResilience<T>(
    operationName: string,
    databaseAction: () => Promise<T>,
  ): Promise<T> {
    try {
      return await databaseAction();
    } catch (caughtError: unknown) {
      if (
        caughtError instanceof Error &&
        caughtError.message.includes('SQLITE_ERROR')
      ) {
        throw new DependencyUnavailableException('Database', operationName);
      }
      throw caughtError;
    }
  }
}
