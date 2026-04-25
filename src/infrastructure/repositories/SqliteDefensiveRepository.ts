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

@Injectable()
export class SqliteDefensiveRepository implements IBalanceRepository {
  constructor(
    @Inject(DI_TOKENS.DB_CONNECTION)
    private readonly db: BetterSQLite3Database<typeof schema>,
  ) {}

  public async findBalance(
    employeeId: string,
    locationId: string,
  ): Promise<Balance | null> {
    const records = await this.db
      .select()
      .from(schema.timeOffBalancesTable)
      .where(
        and(
          eq(schema.timeOffBalancesTable.employeeId, employeeId),
          eq(schema.timeOffBalancesTable.locationId, locationId),
        ),
      )
      .limit(1);
    return records[0] || null;
  }

  public async updateBalance(
    employeeId: string,
    locationId: string,
    amount: number,
  ): Promise<void> {
    const existing = await this.findBalance(employeeId, locationId);
    const now = new Date();

    if (existing) {
      await this.db
        .update(schema.timeOffBalancesTable)
        .set({ amount, lastSync: now })
        .where(
          and(
            eq(schema.timeOffBalancesTable.employeeId, employeeId),
            eq(schema.timeOffBalancesTable.locationId, locationId),
          ),
        );
      return;
    }
    await this.db.insert(schema.timeOffBalancesTable).values({
      id: randomUUID(),
      employeeId,
      locationId,
      amount,
      lastSync: now,
    });
  }

  public async recordTransaction(entry: TransactionAuditLog): Promise<void> {
    await this.db.insert(schema.transactionAuditLogsTable).values({
      id: randomUUID(),
      transactionId: entry.transactionId || null,
      employeeId: entry.employeeId || 'UNKNOWN',
      locationId: entry.locationId || 'UNKNOWN',
      amount: entry.amount,
      actionType: entry.actionType || entry.type || 'UNKNOWN',
      type: entry.type || entry.actionType,
      sourceSystem: entry.sourceSystem || 'SYSTEM',
      createdAt: entry.createdAt,
    });
  }

  public async saveIdempotencyKey(record: IdempotencyRecord): Promise<void> {
    await this.db.insert(schema.idempotencyKeysTable).values({
      key: record.key,
      requestPayload: record.requestPayload,
      responseStatus: record.responseStatus || null,
      responseBody: record.responseBody,
      processedAt: record.processedAt,
      internallyProcessed: record.internallyProcessed || false,
    });
  }

  public async getIdempotencyKey(
    key: string,
  ): Promise<IdempotencyRecord | null> {
    const records = await this.db
      .select()
      .from(schema.idempotencyKeysTable)
      .where(eq(schema.idempotencyKeysTable.key, key))
      .limit(1);

    if (!records[0]) return null;

    const ageInHours =
      (Date.now() - records[0].processedAt.getTime()) / 3600000;
    return ageInHours > 24 ? null : (records[0] as IdempotencyRecord);
  }

  public async getPendingTransactions(
    employeeId: string,
    since: Date,
  ): Promise<TransactionAuditLog[]> {
    const records = await this.db
      .select()
      .from(schema.transactionAuditLogsTable)
      .where(
        and(
          eq(schema.transactionAuditLogsTable.employeeId, employeeId),
          gt(schema.transactionAuditLogsTable.createdAt, since),
        ),
      );

    return records.filter(
      (r) => r.actionType === 'PENDING_HCM_ACK',
    ) as TransactionAuditLog[];
  }
}
