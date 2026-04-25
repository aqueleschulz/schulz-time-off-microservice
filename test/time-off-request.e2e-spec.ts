import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as http from 'http';
import { AppModule } from '../src/app.module';
import { HcmNetworkSimulator } from './integration/hcm-mock-server/HcmNetworkSimulator';

describe('Time-Off Request (e2e) - Defensive Idempotency', () => {
  let nestApplication: INestApplication;
  let hcmSimulator: HcmNetworkSimulator;
  const MOCK_SERVER_PORT = 9999;

  beforeAll(async () => {
    // Override dependency URL to point to our isolated simulator
    process.env.HCM_BASE_URL = `http://localhost:${MOCK_SERVER_PORT}`;

    hcmSimulator = new HcmNetworkSimulator();
    hcmSimulator.startListening(MOCK_SERVER_PORT);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    nestApplication = moduleFixture.createNestApplication();
    await nestApplication.init();
  });

  afterAll(async () => {
    await nestApplication.close();
    hcmSimulator.terminateConnection();
  });

  beforeEach(() => {
    hcmSimulator.stateEngine.reset();
  });

  it('TRD-NFR: Must guarantee idempotency upon 500 Transient HCM failures', async () => {
    const employeeId = 'E-999';
    const locationId = 'LOC-BR';
    const idempotencyKey = 'req-uuid-1234';

    // Setup HCM baseline
    hcmSimulator.stateEngine.seed(employeeId, locationId, 10.0);
    hcmSimulator.stateEngine.setFailureMode('500_then_200');

    const requestPayload = {
      employeeId,
      locationId,
      amount: 2.0,
      type: 'PTO',
    };

    const server = nestApplication.getHttpServer() as unknown as http.Server;

    // First attempt: HCM fails mid-transaction
    await request(server)
      .post('/time-off/request')
      .set('Idempotency-Key', idempotencyKey)
      .send(requestPayload)
      .expect(503); // Assuming adapter translates 500 to a DependencyUnavailable Exception

    // Second attempt: Network recovers. Deduct must NOT be applied twice
    const recoveryResponse = await request(server)
      .post('/time-off/request')
      .set('Idempotency-Key', idempotencyKey)
      .send(requestPayload)
      .expect(202);

    const body = recoveryResponse.body as {
      status: string;
      updatedLocalBalance: number;
    };
    expect(body.status).toBe('APPROVED');
    expect(body.updatedLocalBalance).toBe(8.0);
  });
});
