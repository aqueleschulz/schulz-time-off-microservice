import { Balance, TransactionAuditLog, IdempotencyRecord } from '../entities';

export interface IBalanceRepository {
  /**
   * Executes a database block within a strict ACID transaction lock.
   */
  executeSequentially<T>(
    transactionCallback: (transactionalRepo: IBalanceRepository) => Promise<T>,
  ): Promise<T>;

  findBalance(employeeId: string, locationId: string): Promise<Balance | null>;

  updateBalance(
    employeeId: string,
    locationId: string,
    amount: number,
  ): Promise<void>;

  recordTransaction(auditLog: TransactionAuditLog): Promise<void>;

  saveIdempotencyKey(record: IdempotencyRecord): Promise<void>;

  getIdempotencyKey(key: string): Promise<IdempotencyRecord | null>;

  getPendingTransactions(
    employeeId: string,
    since: Date,
  ): Promise<TransactionAuditLog[]>;
}
