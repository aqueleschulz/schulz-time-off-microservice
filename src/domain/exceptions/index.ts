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
    public readonly targetEmployeeId: string,
    public readonly targetLocationId: string,
    public readonly requestedDeductionAmount: number,
    public readonly currentlyAvailableBalance: number,
  ) {
    super(
      `Employee ${targetEmployeeId} at ${targetLocationId} has insufficient balance: ${currentlyAvailableBalance} < ${requestedDeductionAmount}`,
    );
  }
}

export class InvalidDimensionException extends DomainException {
  constructor(
    public readonly rejectedDimensionType:
      | 'employeeId'
      | 'locationId'
      | 'amount'
      | 'payload',
    public readonly rejectedInvalidValue: string,
  ) {
    super(
      `Invalid dimension - ${rejectedDimensionType}: ${rejectedInvalidValue}`,
    );
  }
}

export class DependencyUnavailableException extends DomainException {
  constructor(
    public readonly failingServiceDependency: 'HCM' | 'Database',
    public readonly failingSystemOperation: string,
  ) {
    super(
      `Dependency ${failingServiceDependency} unavailable during operation: ${failingSystemOperation}`,
    );
  }
}

export class HcmContractViolationException extends DomainException {
  constructor(public readonly violationCauseMessage: string) {
    super(`HCM upstream contract violated: ${violationCauseMessage}`);
  }
}

export class StaleBatchException extends DomainException {
  constructor(
    public readonly rejectedBatchTimestamp: string,
    public readonly currentLocalTimestamp: string,
  ) {
    super(
      `Rejected out-of-order batch. Batch generated at: ${rejectedBatchTimestamp} < Local state: ${currentLocalTimestamp}`,
    );
  }
}

export class CircuitBreakerOpenException extends DomainException {
  constructor(public readonly isolatedServiceName: string) {
    super(
      `Circuit breaker is OPEN for service: ${isolatedServiceName}. Failing fast.`,
    );
  }
}

// --- HCM Mock Errors (Required for downward simulations) ---

export class HcmDimensionMismatchError extends DomainException {
  constructor(missingDimensionMessage: string) {
    super(`HCM Dimension Mismatch: ${missingDimensionMessage}`);
  }
}

export class HcmInsufficientBalanceError extends DomainException {
  constructor(insufficientBalanceMessage: string) {
    super(`HCM Insufficient Balance: ${insufficientBalanceMessage}`);
  }
}

export class HcmServerError extends DomainException {
  constructor(serverErrorMessage: string) {
    super(`HCM Internal Server Error: ${serverErrorMessage}`);
  }
}
