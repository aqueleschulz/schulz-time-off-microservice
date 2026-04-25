import { Balance, TransactionAuditLog, IdempotencyRecord } from '../entities';

/**
 * Outbound port establishing the contract for local defensive cache storage.
 * Enforces strict implementation to avoid test-aware logic leakage.
 * * @example
 * await repository.updateBalance('EMP_1', 'LOC_1', 8.0);
 */
export interface IBalanceRepository {
  findBalance(
    targetEmployeeId: string,
    targetLocationId: string,
  ): Promise<Balance | null>;

  updateBalance(
    targetEmployeeId: string,
    targetLocationId: string,
    newBalanceAmount: number,
  ): Promise<void>;

  recordTransaction(auditLogEntry: TransactionAuditLog): Promise<void>;

  saveIdempotencyKey(idempotencyRecord: IdempotencyRecord): Promise<void>;

  getIdempotencyKey(
    uniqueIdempotencyKey: string,
  ): Promise<IdempotencyRecord | null>;

  getPendingTransactions(
    targetEmployeeId: string,
    sinceTimestamp: Date,
  ): Promise<TransactionAuditLog[]>;
}
