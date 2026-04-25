import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import { HcmAdapterMock, FailureMode } from '../../mocks/HcmAdapterMock';
import { HcmDeductRequestDto } from '../../../src/domain/schemas';

interface TestControlModePayload {
  mode: FailureMode;
}

export class HcmNetworkSimulator {
  private readonly expressApplication: Express;
  private activeHttpServer: Server | null = null;
  public readonly stateEngine: HcmAdapterMock;

  constructor() {
    this.expressApplication = express();
    this.expressApplication.use(express.json());
    this.stateEngine = new HcmAdapterMock();

    this.attachTestControlRoutes();
    this.attachHcmDomainRoutes();
  }

  public startListening(portNumber: number): void {
    this.activeHttpServer = this.expressApplication.listen(portNumber);
  }

  public terminateConnection(): void {
    if (!this.activeHttpServer) return;
    this.activeHttpServer.close();
  }

  private attachTestControlRoutes(): void {
    this.expressApplication.post(
      '/test/failure-mode',
      (req: Request, res: Response) => {
        const payload = req.body as TestControlModePayload;
        this.stateEngine.setFailureMode(payload.mode);
        res
          .status(200)
          .json({ status: 'MODE_APPLIED', activeMode: payload.mode });
      },
    );
  }

  private attachHcmDomainRoutes(): void {
    this.expressApplication.get(
      '/hcm/balance',
      async (req: Request, res: Response) => {
        try {
          const employeeId = req.query.employeeId as string;
          const locationId = req.query.locationId as string;

          const result = await this.stateEngine.getBalance(
            employeeId,
            locationId,
          );
          res.status(200).json(result);
        } catch (error) {
          this.translateExceptionToHttpResponse(error, res);
        }
      },
    );

    this.expressApplication.post(
      '/hcm/deduct',
      async (req: Request, res: Response) => {
        try {
          const payload = req.body as HcmDeductRequestDto;
          const idempotencyHeader = req.headers['idempotency-key'] as string;

          const result = await this.stateEngine.deductBalance(
            payload,
            idempotencyHeader,
          );
          res.status(201).json(result);
        } catch (error) {
          this.translateExceptionToHttpResponse(error, res);
        }
      },
    );
  }

  private translateExceptionToHttpResponse(
    error: unknown,
    response: Response,
  ): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown';

    if (errorMessage === 'ETIMEDOUT') {
      response.status(408).json({ error: 'Request Timeout' });
      return;
    }

    // Translate all abstract mock errors directly into 500s
    // so the adapter's Circuit Breaker can do its job and retry.
    response.status(500).json({
      error: 'Internal Server Error',
      code: 'HCM_500',
      detail: errorMessage,
    });
  }
}
