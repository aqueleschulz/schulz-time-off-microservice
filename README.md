# schulz-time-off-microservice

**GitHub Repository:** [aqueleschulz/schulz-time-off-microservice](https://github.com/aqueleschulz/schulz-time-off-microservice)

## Mission Statement

The **Schulz Time-Off Microservice** is a resilient, defensive middleware layer engineered to bridge the gap between the ExampleHR application and unpredictable upstream Human Capital Management (HCM) systems such as SAP or Workday. While the HCM remains the absolute **Source of Truth** for employee balances, this microservice guarantees **instant feedback** to end-users by maintaining an intelligent SQLite cache that self-heals through Just-In-Time (JIT) Hydration and Delta Reconciliation.

This project demonstrates production-grade distributed systems engineering, with rigorous test coverage, explicit error handling, and strict adherence to Clean Architecture principles. The entire codebase was orchestrated via **Agentic Development** using Gemini 3.1 Pro and Claude 4.5 Sonnet under human supervision, following the challenge's requirement for zero manual lines of code.

---

## Technical Challenges & Resilience

### 1. JIT Hydration (Preventing False Negatives)
**Problem:** The HCM can grant out-of-band bonuses (e.g., work anniversaries) that aren't immediately reflected in the local cache. A naive implementation would reject legitimate time-off requests.

**Solution:** When the local balance appears insufficient, the system intercepts the rejection and performs a synchronous fetch to the HCM. If the upstream balance is higher, the cache is updated in real-time before re-evaluating the request. This guarantees that users never experience "false negatives" due to stale data.

### 2. Delta Reconciliation (Handling Batch Mutations)
**Problem:** The HCM sends batch updates asynchronously. If an employee requests time off while a batch is in transit, a naive overwrite would erase the pending deduction.

**Solution:** The batch reconciliation engine applies a **delta calculation**: `Final Balance = HCM Batch Balance - SUM(Unacknowledged Local Deductions)`. The system queries the `transaction_audit_logs` table for pending transactions created after the batch timestamp, ensuring in-flight requests are never lost.

### 3. Defensive Adapter (Standardizing Chaos)
**Problem:** The HCM's error responses are inconsistent (malformed JSON, ambiguous 400/500 codes, silent timeouts).

**Solution:** The **HcmAdapter** implements a strict translation layer using Zod schemas for validation and the Adapter Pattern to convert raw HTTP exceptions into predictable domain exceptions (`InsufficientBalanceException`, `InvalidDimensionException`, `DependencyUnavailableException`). This isolates the core business logic from infrastructure volatility.

### 4. Circuit Breaker & Fail-Open Strategy
**Problem:** During total HCM outages, rejecting all requests would create a catastrophic user experience.

**Solution:** The system uses **Opossum** to monitor HCM health. When the circuit opens, the service enters **Fail-Open Mode**: if the local cache confirms sufficient balance, the request is approved locally and queued for upstream sync once the HCM recovers. The user receives instant feedback even during disasters.

---

## Setup & Operation

### Prerequisites
- **Node.js:** v20+ (required for native ESM support)
- **NPM:** Latest stable version
- **Docker & Docker Compose:** For containerized execution (recommended)

### Environment Variables
For local execution outside of Docker, configure the following variables in your environment or a `.env` file:

- `PORT`: Server port (default: `3000`)
- `HCM_BASE_URL`: Base URL for the upstream HCM service (e.g., `http://localhost:9999`)
- `DATABASE_URL`: SQLite connection string (e.g., `file:./data/time-off.db`)

### Installation
```bash
git clone https://github.com/aqueleschulz/schulz-time-off-microservice.git
cd schulz-time-off-microservice
npm install
```

### Execution

#### Local Development
```bash
npm run start:dev
```
- **Application:** http://localhost:3000
- **Swagger UI:** http://localhost:3000/api

#### Docker (Recommended)
```bash
docker-compose up --build
```
- **Application:** http://localhost:3000
- **HCM Mock Server:** http://localhost:9999
- **Swagger UI:** http://localhost:3000/api

The Docker setup includes an isolated HCM Mock Server that simulates real-world failure scenarios (timeouts, 500 errors, malformed responses) for testing resilience.

---

## Test Suite

### Commands
- **Unit & Property Tests:** `npm test`
- **End-to-End Tests:** `npm run test:e2e`
- **Coverage Report:** `npm run test:cov`

### Coverage Target
The project achieves **87% code coverage** across critical paths, with 100% coverage on domain services and adapters.

### Technical Highlights
1. **Property-Based Testing (PBT):** Uses `fast-check` to validate concurrent integrity with randomized input sequences, exposing race conditions that traditional example-based tests miss.
2. **Stateful Named Mocks:** All external dependencies (HCM, DB) are mocked using concrete classes (`HcmAdapterMock`, `LocalBalanceRepositoryMock`) that simulate real-world state, not inline stubs.
3. **Regression Tests:** Every bug discovered in development generated a new test case before the fix was applied (TDD discipline).

### Test Results
```
Test Suites: 8 passed, 8 total
Tests:       29 passed, 29 total
```

---

## API Reference

### 1. Request Time Off
**Endpoint:** `POST /time-off/request`

**Headers:**
- `Idempotency-Key` (required): UUID to prevent duplicate deductions during retries.

**Request Body:**
```json
{
  "employeeId": "EMP_123",
  "locationId": "LOC_456",
  "amount": 2.0,
  "type": "PTO"
}
```

**Success Response (202 Accepted):**
```json
{
  "status": "APPROVED",
  "transactionId": "txn_789",
  "updatedLocalBalance": 8.0,
  "hcmSyncStatus": "SYNCED"
}
```

**Failure States:**
- `400 Bad Request`: Invalid dimensions (negative amount, malformed IDs).
- `409 Conflict`: Insufficient balance after JIT verification.
- `503 Service Unavailable`: Circuit breaker open (HCM down).

**Example (curl):**
```bash
curl -X POST http://localhost:3000/time-off/request \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{
    "employeeId": "EMP_123",
    "locationId": "LOC_456",
    "amount": 2.0,
    "type": "PTO"
  }'
```

---

### 2. Get Balance
**Endpoint:** `GET /time-off/balance`

**Query Parameters:**
- `employeeId` (required): Employee identifier.
- `locationId` (required): Location identifier.

**Success Response (200 OK):**
```json
{
  "employeeId": "EMP_123",
  "locationId": "LOC_456",
  "amount": 10.0,
  "lastSync": "2026-04-24T13:22:46.000Z"
}
```

**Example (curl):**
```bash
curl "http://localhost:3000/time-off/balance?employeeId=EMP_123&locationId=LOC_456"
```

---

### 3. Batch Reconciliation
**Endpoint:** `POST /sync/batch`

**Request Body:**
```json
{
  "batchId": "batch_999",
  "generatedAt": "2026-04-24T14:00:00Z",
  "balances": [
    {
      "employeeId": "EMP_123",
      "locationId": "LOC_456",
      "balance": 11.0
    }
  ]
}
```

**Success Response (207 Multi-Status):**
```json
{
  "batchId": "batch_999",
  "processedCount": 1,
  "errorCount": 0,
  "results": [
    {
      "employeeId": "EMP_123",
      "status": "SUCCESS"
    }
  ]
}
```

**Example (curl):**
```bash
curl -X POST http://localhost:3000/sync/batch \
  -H "Content-Type: application/json" \
  -d '{
    "batchId": "batch_999",
    "generatedAt": "2026-04-24T14:00:00Z",
    "balances": [
      {
        "employeeId": "EMP_123",
        "locationId": "LOC_456",
        "balance": 11.0
      }
    ]
  }'
```

---

## Project Structure
```
/
├── docs/
│   └── TRD.md              # Technical Reference Document (Architecture Bible)
├── src/
│   ├── domain/             # Core business logic (Clean Architecture)
│   │   ├── entities/       # Balance, TransactionAuditLog, IdempotencyRecord
│   │   ├── exceptions/     # Domain-specific errors
│   │   ├── ports/          # IHcmPort, IBalanceRepository interfaces
│   │   ├── schemas/        # DTOs for external communication
│   │   └── services/       # TimeOffService (orchestration logic)
│   ├── infrastructure/     # External integrations
│   │   ├── adapters/       # HcmAdapter (Circuit Breaker + Retry Logic)
│   │   ├── database/       # Drizzle ORM schema + SQLite connection
│   │   └── repositories/   # SqliteDefensiveRepository
│   ├── presentation/       # REST API layer
│   │   ├── controllers/    # TimeOffTransactionController, BatchReconciliationController
│   │   ├── dtos/           # NestJS validation decorators
│   │   └── filters/        # Global exception handling
│   ├── app.module.ts       # NestJS root module
│   └── main.ts             # Bootstrap + Swagger setup
├── test/
│   ├── mocks/              # Named mock classes (HcmAdapterMock, etc.)
│   ├── integration/        # HcmNetworkSimulator (for E2E tests)
│   └── *.spec.ts           # Unit, property-based, and E2E tests
├── drizzle/                # SQLite migrations
├── docker-compose.yml      # Multi-service orchestration
├── .dockerfile             # Multi-stage production build
└── package.json            # NPM scripts and dependencies
```

---

## Compliance Checklist

- [x] **NestJS & SQLite Stack:** Production-grade TypeScript framework with lightweight embedded database.
- [x] **Per-Employee Per-Location Balances:** Composite unique index on `(employee_id, location_id)`.
- [x] **Defensive HCM Error Handling:** Adapter pattern with Zod schema validation and explicit exception mapping.
- [x] **Comprehensive TRD:** 10-section Technical Reference Document located in `/docs/TRD.md`.
- [x] **0 Lines of Manual Code:** Entire codebase generated via Agentic Development (Gemini 3.1 Pro and Claude 4.5 Sonnet).
- [x] **Test Coverage:** 87% with property-based tests for race conditions.
- [x] **Idempotency:** Full support via `Idempotency-Key` header and TTL-based registry.
- [x] **Circuit Breaker:** Opossum integration with configurable thresholds.
- [x] **Docker Support:** Multi-service orchestration with isolated HCM mock server.
- [x] **API Documentation:** Swagger UI available at `/api` endpoint.

---

## Trade-offs & Decisions

### 1. SQLite vs. PostgreSQL
**Decision:** SQLite with WAL mode.  
**Rationale:** The instant feedback NFR demands minimal overhead. SQLite's file-based nature eliminates network latency, while WAL mode provides row-level locking for concurrency. PostgreSQL would add operational complexity (connection pooling, separate container) without measurable benefit for this workload.  
**Trade-off:** We sacrifice horizontal scalability (multi-instance writes) for instant feedback and deployment simplicity.

### 2. Drizzle ORM vs. Prisma
**Decision:** Drizzle ORM.  
**Rationale:** Prisma generates a ~40MB Rust binary that inflates cold starts and container size. Drizzle runs SQL directly with zero runtime overhead, aligning with the "Minimal APIs" philosophy.  
**Trade-off:** We lose Prisma's GUI-based schema management but gain ~90% reduction in bundle size and native TypeScript type inference.

### 3. Fail-Open vs. Strict Validation
**Decision:** Fail-open during HCM outages (if local balance is sufficient).  
**Rationale:** User experience degradation during upstream failures is catastrophic in HR systems. The local cache acts as a "last known good state," and transactions are queued for eventual sync.  
**Trade-off:** We introduce eventual consistency but maintain system availability during disasters.

---

## License
MIT License. See [LICENSE](./LICENSE) for details.

---

**Built with precision. Architected for resilience. Documented for comprehension.**