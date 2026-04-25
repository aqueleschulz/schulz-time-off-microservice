/**
 * Base abstract class ensuring all domain exceptions are properly serialized for JSON logs.
 */
export abstract class DomainException extends Error {
  public readonly name: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  public toJSON(): Record<string, unknown> {
    return { name: this.name, message: this.message };
  }
}

export class InsufficientBalanceException extends DomainException {
  constructor(
    public readonly employeeId: string,
    public readonly locationId: string,
    public readonly requestedAmount: number,
    public readonly availableBalance: number,
  ) {
    super(
      `Employee ${employeeId} at ${locationId} has insufficient balance: ${availableBalance} < ${requestedAmount}`,
    );
  }
}

export class InvalidDimensionException extends DomainException {
  constructor(
    public readonly dimensionType:
      | 'employeeId'
      | 'locationId'
      | 'amount'
      | 'payload',
    public readonly invalidValue: string,
  ) {
    super(`Invalid dimension - ${dimensionType}: ${invalidValue}`);
  }
}

export class DependencyUnavailableException extends DomainException {
  constructor(
    public readonly service: 'HCM' | 'Database',
    public readonly operation: string,
  ) {
    super(`Dependency ${service} unavailable during operation: ${operation}`);
  }
}

export class HcmContractViolationException extends DomainException {
  constructor(
    public readonly cause: string,
    public readonly rawResponse?: unknown,
  ) {
    super(`HCM upstream contract violated: ${cause}`);
  }
}

export class StaleBatchException extends DomainException {
  constructor(
    public readonly batchTimestamp: string,
    public readonly localTimestamp: string,
  ) {
    super(
      `Rejected out-of-order batch. Batch generated at: ${batchTimestamp} < Local state: ${localTimestamp}`,
    );
  }
}

export class CircuitBreakerOpenException extends DomainException {
  constructor(public readonly service: string) {
    super(`Circuit breaker is OPEN for service: ${service}. Failing fast.`);
  }
}

// --- HCM Mock Errors (Required by tests for downstream simulations) ---

export class HcmDimensionMismatchError extends DomainException {
  constructor(message: string) {
    super(`HCM Dimension Mismatch: ${message}`);
  }
}

export class HcmInsufficientBalanceError extends DomainException {
  constructor(message: string) {
    super(`HCM Insufficient Balance: ${message}`);
  }
}

export class HcmServerError extends DomainException {
  constructor(message: string) {
    super(`HCM Internal Server Error: ${message}`);
  }
}
