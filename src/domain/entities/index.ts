/**
 * Represents a cached balance ledger for an employee at a specific location.
 * @example
 * const balance: Balance = { employeeId: 'E1', locationId: 'L1', amount: 10.0, lastSync: new Date() };
 */
export interface Balance {
  readonly employeeId: string;
  readonly locationId: string;
  amount: number;
  lastSync: Date;
}

/**
 * Immutable audit log entry for transaction traceability and batch reconciliation.
 * @example
 * const log: TransactionAuditLog = { transactionId: 'tx-123', amount: 3.0, actionType: 'LOCAL_DEDUCTION', createdAt: new Date() };
 */
export interface TransactionAuditLog {
  readonly transactionId?: string;
  readonly employeeId?: string;
  readonly locationId?: string;
  readonly amount: number;
  readonly actionType?: string;
  readonly type?: string; // Supports older batch-reconciliation test schemas
  readonly sourceSystem?: string;
  readonly createdAt: Date;
}

/**
 * Registry for guaranteeing idempotency of requests to prevent duplicate deductions.
 * @example
 * const record: IdempotencyRecord = { key: 'uuid-123', processedAt: new Date(), internallyProcessed: true };
 */
export interface IdempotencyRecord {
  readonly key: string;
  readonly requestPayload?: unknown;
  readonly responseStatus?: number;
  readonly responseBody?: unknown;
  processedAt: Date;
  readonly internallyProcessed?: boolean;
}
