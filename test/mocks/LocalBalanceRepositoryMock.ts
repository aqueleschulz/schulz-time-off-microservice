import { IBalanceRepository } from '../../src/domain/ports/IBalanceRepository';
import {
  Balance,
  TransactionAuditLog,
  IdempotencyRecord,
} from '../../src/domain/entities';

/**
 * In-memory simulator for SQLite database behavior.
 * Provides explicit test helpers to validate domain logic and NFRs.
 */
export class LocalBalanceRepositoryMock implements IBalanceRepository {
  private balances = new Map<string, Balance>();
  private auditLogs: TransactionAuditLog[] = [];
  private idempotencyKeys = new Map<string, IdempotencyRecord>();
  private rowLocks = new Set<string>();

  private isCrashed = false;
  private latencyMs = 0;
  private queryCount = 0;

  // --- Test Helpers ---

  public simulateCrash(crashed: boolean): void {
    this.isCrashed = crashed;
  }
  public setLatency(ms: number): void {
    this.latencyMs = ms;
  }
  public getQueryCount(): number {
    return this.queryCount;
  }
  public resetQueryCount(): void {
    this.queryCount = 0;
  }
  public addAuditLog(entry: TransactionAuditLog): void {
    this.auditLogs.push(entry);
  }
  public getAuditLogs(): TransactionAuditLog[] {
    return this.auditLogs;
  }

  public seed(
    empId: string,
    locId: string,
    amount: number,
    date = new Date(),
  ): void {
    this.balances.set(`${empId}::${locId}`, {
      employeeId: empId,
      locationId: locId,
      amount,
      lastSync: date,
    });
  }

  public async getBalance(
    employeeId: string,
    locationId: string,
  ): Promise<number> {
    const balance = await this.findBalance(employeeId, locationId);
    return balance ? balance.amount : 0;
  }

  // --- IBalanceRepository Implementation ---

  public async findBalance(
    employeeId: string,
    locationId: string,
  ): Promise<Balance | null> {
    await this.simulateIO();
    this.queryCount++;
    return this.balances.get(`${employeeId}::${locationId}`) || null;
  }

  public async saveIdempotencyKey(record: IdempotencyRecord): Promise<void> {
    await this.simulateIO();
    this.idempotencyKeys.set(record.key, record);
  }

  public async getIdempotencyKey(
    key: string,
  ): Promise<IdempotencyRecord | null> {
    await this.simulateIO();
    const record = this.idempotencyKeys.get(key);
    if (!record) return null;

    const ageInHours = (Date.now() - record.processedAt.getTime()) / 3600000;
    return ageInHours > 24 ? null : record; // 24h TTL validation
  }

  public async updateBalance(
    employeeId: string,
    locationId: string,
    amount: number,
  ): Promise<void> {
    await this.simulateIO();
    const key = `${employeeId}::${locationId}`;
    await this.acquireLock(key);

    try {
      const current = this.balances.get(key);
      if (current) {
        current.amount = amount;
        current.lastSync = new Date();
      }
    } finally {
      this.rowLocks.delete(key);
    }
  }

  public async recordTransaction(entry: TransactionAuditLog): Promise<void> {
    await this.simulateIO();
    this.auditLogs.push(entry);
  }

  // --- Private Internal Logic ---

  private async acquireLock(key: string): Promise<void> {
    while (this.rowLocks.has(key)) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    this.rowLocks.add(key);
  }

  private async simulateIO(): Promise<void> {
    if (this.isCrashed)
      throw new Error('SQLITE_ERROR: Database connection lost');
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }
  }
}
