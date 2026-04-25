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

  /**
   * Binds the mock server to a specific port for E2E network simulation.
   * Example: simulator.startListening(9999);
   */
  public startListening(portNumber: number): void {
    this.activeHttpServer = this.expressApplication.listen(portNumber);
  }

  /**
   * Safely unbinds the server to prevent Jest port-in-use memory leaks.
   * Example: simulator.terminateConnection();
   */
  public terminateConnection(): void {
    if (!this.activeHttpServer) return;
    this.activeHttpServer.close();
  }

  private attachTestControlRoutes(): void {
    this.expressApplication.post('/test/failure-mode', (req: Request, res: Response) => {
      const payload = req.body as TestControlModePayload;
      this.stateEngine.setFailureMode(payload.mode);
      res.status(200).json({ status: 'MODE_APPLIED', activeMode: payload.mode });
    });
  }

  private attachHcmDomainRoutes(): void {
    // Translates the abstract mock logic into real HTTP boundary responses
    this.expressApplication.post('/hcm/time-off', async (req: Request, res: Response) => {
      try {
        const payload = req.body as HcmDeductRequestDto;
        const idempotencyHeader = req.headers['idempotency-key'] as string;
        
        const result = await this.stateEngine.deductBalance(payload, idempotencyHeader);
        res.status(201).json(result);
      } catch (error) {
        this.translateExceptionToHttpResponse(error, res);
      }
    });
  }

  private translateExceptionToHttpResponse(error: unknown, response: Response): void {
    const errorMessage = error instanceof Error ? error.message : 'Unknown';
    
    if (errorMessage === 'ETIMEDOUT') {
      response.status(408).json({ error: 'Request Timeout' });
      return;
    }
    
    if (errorMessage.includes('500') || errorMessage.includes('Transient')) {
      response.status(500).json({ error: 'Internal HCM Error' });
      return;
    }

    response.status(400).json({ error: errorMessage });
  }
}