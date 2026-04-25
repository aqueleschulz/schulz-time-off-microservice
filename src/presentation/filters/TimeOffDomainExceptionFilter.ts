import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import {
  DomainException,
  InsufficientBalanceException,
  InvalidDimensionException,
  DependencyUnavailableException,
  CircuitBreakerOpenException,
  StaleBatchException,
} from '../../domain/exceptions';

@Catch(DomainException, Error)
export class TimeOffDomainExceptionFilter implements ExceptionFilter {
  public catch(exception: Error, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = this.determineHttpStatusCode(exception);
    const message = exception.message || 'Internal Server Error';

    response.status(status).json({
      error: exception.name,
      message: message,
      timestamp: new Date().toISOString(),
    });
  }

  private determineHttpStatusCode(exception: Error): number {
    if (exception.message.includes('SQLITE_ERROR'))
      return HttpStatus.INTERNAL_SERVER_ERROR;

    if (exception instanceof InsufficientBalanceException)
      return HttpStatus.CONFLICT;
    if (exception instanceof StaleBatchException) return HttpStatus.CONFLICT;

    if (exception instanceof InvalidDimensionException)
      return HttpStatus.BAD_REQUEST;

    if (exception instanceof DependencyUnavailableException)
      return HttpStatus.SERVICE_UNAVAILABLE;
    if (exception instanceof CircuitBreakerOpenException)
      return HttpStatus.SERVICE_UNAVAILABLE;

    return HttpStatus.UNPROCESSABLE_ENTITY;
  }
}
