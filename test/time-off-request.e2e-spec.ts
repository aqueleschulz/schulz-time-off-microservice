import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as http from 'http';
import { AppModule } from '../src/app.module';
import { HcmNetworkSimulator } from './integration/hcm-mock-server/HcmNetworkSimulator';
import { TimeOffDomainExceptionFilter } from '../src/presentation/filters/TimeOffDomainExceptionFilter';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DI_TOKENS } from '../src/infrastructure/di/InjectionTokens';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

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

    // Must mount global pipes and filters to match the production setup
    nestApplication.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    nestApplication.useGlobalFilters(new TimeOffDomainExceptionFilter());

    await nestApplication.init();

    const dbConnection = nestApplication.get<BetterSQLite3Database>(DI_TOKENS.DB_CONNECTION);
    migrate(dbConnection, { migrationsFolder: './drizzle' });
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

    // First attempt: HCM fails mid-transaction, but our adapter resiliently retries and recovers!
    const firstResponse = await request(server)
      .post('/time-off/request')
      .set('Idempotency-Key', idempotencyKey)
      .send(requestPayload)
      .expect(202);

    const body1 = firstResponse.body as {
      status: string;
      updatedLocalBalance: number;
    };
    expect(body1.status).toBe('APPROVED');
    expect(body1.updatedLocalBalance).toBe(8.0);

    // Second attempt: Network has recovered. Deduct must NOT be applied twice (Idempotency check)
    const recoveryResponse = await request(server)
      .post('/time-off/request')
      .set('Idempotency-Key', idempotencyKey)
      .send(requestPayload)
      .expect(202);

    const body2 = recoveryResponse.body as {
      status: string;
      updatedLocalBalance: number;
    };
    expect(body2.status).toBe('APPROVED');
    expect(body2.updatedLocalBalance).toBe(8.0);
  });
});
