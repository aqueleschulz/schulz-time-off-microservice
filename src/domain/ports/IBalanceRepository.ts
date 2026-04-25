import { Balance, TransactionAuditLog, IdempotencyRecord } from '../entities';

/**
 * Outbound port establishing the contract for local defensive cache storage.
 * @example
 * await repository.updateBalance('EMP_1', 'LOC_1', 8.0);
 */
export interface IBalanceRepository {
  findBalance(employeeId: string, locationId: string): Promise<Balance | null>;
  updateBalance(
    employeeId: string,
    locationId: string,
    amount: number,
  ): Promise<void>;
  recordTransaction(entry: TransactionAuditLog): Promise<void>;
  saveIdempotencyKey(record: IdempotencyRecord): Promise<void>;
  getIdempotencyKey(key: string): Promise<IdempotencyRecord | null>;
  getPendingTransactions?(
    employeeId: string,
    since: Date,
  ): Promise<TransactionAuditLog[]>;
}
