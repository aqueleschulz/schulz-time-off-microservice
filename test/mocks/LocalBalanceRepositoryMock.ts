import { IBalanceRepository } from '../../src/domain/ports/IBalanceRepository';
import {
  Balance,
  TransactionAuditLog,
  IdempotencyRecord,
} from '../../src/domain/entities';
import { DependencyUnavailableException } from '../../src/domain/exceptions';

/**
 * A Promise-based Mutex to simulate SQLite's SERIALIZABLE database locks.
 * Ensures concurrent requests do not overwrite shared state.
 */
class Mutex {
  private queue = Promise.resolve();

  public lock(): Promise<() => void> {
    let begin: (unlock: () => void) => void = () => {};
    this.queue = this.queue.then(() => new Promise(begin));
    return new Promise((resolve) => {
      begin = resolve;
    });
  }
}

interface SharedMemoryState {
  balances: Map<string, Balance>;
  auditLogs: TransactionAuditLog[];
  idempotencyKeys: Map<string, IdempotencyRecord>;
  dbLock: Mutex;
  metrics: { queryCount: number; shouldCrash: boolean; latencyMs: number };
}

export class LocalBalanceRepositoryMock implements IBalanceRepository {
  private readonly balances: Map<string, Balance>;
  private readonly auditLogs: TransactionAuditLog[];
  private readonly idempotencyKeys: Map<string, IdempotencyRecord>;
  private readonly dbLock: Mutex;
  private readonly metrics: {
    queryCount: number;
    shouldCrash: boolean;
    latencyMs: number;
  };

  constructor(sharedState?: SharedMemoryState) {
    if (sharedState) {
      this.balances = sharedState.balances;
      this.auditLogs = sharedState.auditLogs;
      this.idempotencyKeys = sharedState.idempotencyKeys;
      this.dbLock = sharedState.dbLock;
      this.metrics = sharedState.metrics;
    } else {
      this.balances = new Map();
      this.auditLogs = [];
      this.idempotencyKeys = new Map();
      this.dbLock = new Mutex();
      this.metrics = { queryCount: 0, shouldCrash: false, latencyMs: 0 };
    }
  }

  // --- Utility Methods for Test Suite ---

  public simulateCrash(shouldCrash: boolean): void {
    this.metrics.shouldCrash = shouldCrash;
  }

  public setLatency(ms: number): void {
    this.metrics.latencyMs = ms;
  }

  public getQueryCount(): number {
    return this.metrics.queryCount;
  }

  public resetQueryCount(): void {
    this.metrics.queryCount = 0;
  }

  public addAuditLog(log: TransactionAuditLog): void {
    this.auditLogs.push(log);
  }

  public getAuditLogs(): TransactionAuditLog[] {
    return this.auditLogs;
  }
  public async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<number> {
    await this.applyResilienceGuard();
    return this.balances.get(`${employeeId}-${locationId}`)?.amount || 0;
  }

  public seed(
    employeeId: string,
    locationId: string,
    amount: number,
    syncDate?: Date,
  ): void {
    this.balances.set(`${employeeId}-${locationId}`, {
      employeeId,
      locationId,
      amount,
      lastSync: syncDate || new Date(),
    });
  }

  private async applyResilienceGuard(): Promise<void> {
    this.metrics.queryCount++;
    if (this.metrics.latencyMs > 0) {
      await new Promise((resolve) =>
        setTimeout(resolve, this.metrics.latencyMs),
      );
    }
    if (this.metrics.shouldCrash) {
      throw new DependencyUnavailableException('Database', 'Simulated Crash');
    }
  }

  // --- IBalanceRepository Implementation ---

  public async executeSequentially<T>(
    transactionCallback: (transactionalRepo: IBalanceRepository) => Promise<T>,
  ): Promise<T> {
    await this.applyResilienceGuard();
    const unlockMutex = await this.dbLock.lock();
    try {
      const transactionalInstance = new LocalBalanceRepositoryMock({
        balances: this.balances,
        auditLogs: this.auditLogs,
        idempotencyKeys: this.idempotencyKeys,
        dbLock: this.dbLock,
        metrics: this.metrics,
      });
      return await transactionCallback(transactionalInstance);
    } finally {
      unlockMutex();
    }
  }

  public async findBalance(
    employeeId: string,
    locationId: string,
  ): Promise<Balance | null> {
    await this.applyResilienceGuard();
    return this.balances.get(`${employeeId}-${locationId}`) || null;
  }

  public async updateBalance(
    employeeId: string,
    locationId: string,
    amount: number,
  ): Promise<void> {
    await this.applyResilienceGuard();
    this.balances.set(`${employeeId}-${locationId}`, {
      employeeId,
      locationId,
      amount,
      lastSync: new Date(),
    });
  }

  public async recordTransaction(auditLog: TransactionAuditLog): Promise<void> {
    await this.applyResilienceGuard();
    this.auditLogs.push(auditLog);
  }

  public async saveIdempotencyKey(record: IdempotencyRecord): Promise<void> {
    await this.applyResilienceGuard();
    this.idempotencyKeys.set(record.key, record);
  }

  public async getIdempotencyKey(
    key: string,
  ): Promise<IdempotencyRecord | null> {
    await this.applyResilienceGuard();
    const record = this.idempotencyKeys.get(key);
    if (!record) return null;

    const IDEMPOTENCY_TTL_HOURS = 24;
    const ageInHours = (Date.now() - record.processedAt.getTime()) / 3600000;

    return ageInHours > IDEMPOTENCY_TTL_HOURS ? null : record;
  }

  public async getPendingTransactions(
    employeeId: string,
    since: Date,
  ): Promise<TransactionAuditLog[]> {
    await this.applyResilienceGuard();
    return this.auditLogs.filter(
      (log) =>
        log.employeeId === employeeId &&
        log.actionType === 'PENDING_HCM_ACK' &&
        log.createdAt > since,
    );
  }
}
