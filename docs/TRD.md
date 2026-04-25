# Technical Requirement Document (TRD) - Time-Off Microservice (Part 1)

## 1. Executive Summary & NFRs

The Time-Off Microservice is designed as a highly resilient, defensive middleware layer sitting between the ExampleHR application and upstream Human Capital Management (HCM) systems. While the HCM remains the absolute "Source of Truth" for employment data, this microservice acts as an intelligent, self-healing cache and transaction manager to provide instant feedback to the end-user. It is built using a Clean Architecture approach with NestJS and SQLite, employing an Adapter pattern to standardize and sanitize unpredictable external API responses into strict internal domain exceptions.

**Non-Functional Requirements (NFRs):**
* **Availability & Instant Feedback:** Must provide sub-200ms read responses to the ExampleHR UI, masking upstream HCM latency or downtime.
* **Resilience (Idempotency):** The system must guarantee that network timeouts, client retries, or upstream 500 errors never result in a duplicated deduction of time-off balances.
* **Data Integrity & Defensiveness:** The service must be highly defensive, assuming the HCM might silently fail to enforce dimension or balance constraints. Local state must never drift permanently from the HCM truth.

## 2. Technical Challenges

Building a robust synchronization engine between a high-traffic UI and a legacy Source of Truth introduces several critical challenges:

* **The "Source of Truth" Synchronization Dilemma:** Keeping balances synced between two distinct systems is notoriously difficult. The local SQLite database is inherently a cache; trusting it completely risks false positives/negatives, while strictly querying the HCM for every interaction violates the instant feedback requirement.
* **Independent HCM Updates (Out-of-Band Mutations):** The HCM will mutate balances independently of ExampleHR, such as granting work anniversary bonuses or start-of-the-year refreshes. Our system must reconcile these silent updates without blocking ongoing user requests.
* **High-Availability vs. Eventual Consistency:** ExampleHR users demand accurate, real-time balances. Relying solely on a scheduled batch update means operating on eventually consistent data, risking a scenario where an employee's dashboard shows an outdated balance immediately after an HCM-side update.
* **Idempotency & Race Conditions:** In a distributed setup where HCM error reporting is not always guaranteed, simultaneous requests (e.g., rapid double-clicks on the UI or concurrent processing) could bypass balance checks. 

## 3. Data Modeling (SQLite + Drizzle)

To support our defensive strategy and ensure robust local validation, the database schema in Drizzle ORM will implement the following core structures:

* **Balances Table (`time_off_balances`)**
    * Acts as our intelligent local cache.
    * **Fields:** `id` (PK), `employee_id` (Index), `location_id`, `balance_amount` (Integer), `last_sync_timestamp` (DateTime).
    * **Constraint:** Unique composite key on `(employee_id, location_id)` to prevent duplicate ledger entries.
* **Idempotency Table (`idempotency_keys`)**
    * Vital for preventing duplicate time-off deductions during retry loops.
    * **Fields:** `key` (PK, UUID), `request_payload` (JSON), `response_status` (HTTP Code), `response_body` (JSON), `locked_at` (DateTime), `created_at` (DateTime).
* **Audit/Log Table (`transaction_audit_logs`)**
    * An append-only ledger crucial for dispute resolution when the local cache diverges from the HCM.
    * **Fields:** `id` (PK), `transaction_id` (UUID), `employee_id`, `action_type` (e.g., `LOCAL_DEDUCTION`, `BATCH_RECONCILIATION`), `amount_delta` (+/-), `source_system` (ExampleHR vs HCM), `created_at`.

## 4. API Contracts (REST Definitions)

Adhering to the "Minimal APIs" philosophy, the REST contracts are kept lean and explicitly typed.

* **`POST /time-off/request`**
    * **Headers:** `Idempotency-Key` (Required, UUID).
    * **Payload:**
        ```json
        {
          "employeeId": "emp_123",
          "locationId": "loc_456",
          "amount": 2.0,
          "type": "PTO"
        }
        ```
    * **Expected Response (202 Accepted / 200 OK):**
        ```json
        {
          "status": "APPROVED",
          "transactionId": "txn_789",
          "updatedLocalBalance": 8.0,
          "hcmSyncStatus": "SYNCED" 
        }
        ```
    * **Failure States:** `400 Bad Request` (Invalid dimensions), `409 Conflict` (Insufficient local balance - triggers real-time HCM verification), `422 Unprocessable Entity` (HCM rejected).

* **`GET /time-off/balance`**
    * **Query Params:** `?employeeId=emp_123&locationId=loc_456`
    * **Expected Response (200 OK):**
        ```json
        {
          "employeeId": "emp_123",
          "locationId": "loc_456",
          "balance": 10.0,
          "lastSync": "2026-04-24T13:22:46.000Z",
          "isStale": false
        }
        ```

* **`POST /sync/batch`**
    * This endpoint receives the "whole corpus" of balances from the HCM.
    * **Payload:**
        ```json
        {
          "batchId": "batch_999",
          "balances": [
            { "employeeId": "emp_123", "locationId": "loc_456", "balance": 11.0 }
          ]
        }
        ```
    * **Expected Response (202 Accepted):** Returns an immediate 202 to the HCM to avoid timeout, queuing the payload for background reconciliation against the `time_off_balances` table.

## 5. Multi-tenancy Roadmap

While the MVP is scoped strictly to balances per-employee per-location, the architecture is deliberately designed to avoid future friction when adding multi-tenancy. 

The composite unique constraints and primary lookup indices currently built around `(employee_id, location_id)` are structured so that a `tenant_id` can simply be prepended to the composite key: `(tenant_id, employee_id, location_id)`. By relying heavily on Drizzle ORM's querying mechanics and keeping our SQL logic cleanly separated in repository adapters, we can implement row-level security and tenant isolation in the future without rewriting our domain logic or altering the core algorithm of our Time-Off Microservice.

## 6. Proposed Architecture & JIT Hydration Flow

The microservice strictly adheres to **Clean Architecture** principles, aggressively isolating the core business domain from external infrastructure (HCM APIs, SQLite database, and NestJS framework transport layers). We enforce complete structural integrity using **TypeScript**, relying on explicit interfaces and types for all boundaries. The use of `any` or loose `Dict` types is strictly prohibited, ensuring that external payloads are validated against rigid Data Transfer Objects (DTOs) before crossing into the domain layer.

To satisfy the requirement for high availability while guarding against the "false negative" scenario (where an out-of-band HCM update, like an anniversary bonus, isn't yet reflected locally), we implement a **Just-In-Time (JIT) Hydration** strategy. 

When the local cache indicates insufficient funds, the system intercepts the rejection and performs a synchronous, real-time fetch to the HCM to verify the true state before answering the user.

@startuml
participant "ExampleHR UI" as UI
participant "Time-Off Microservice" as MS
participant "SQLite (Local Cache)" as DB
participant "HCM API" as HCM

UI -> MS : POST /time-off/request (amount: 2 days)
MS -> DB : Read local balance
DB --> MS : Balance: 1 day

note over MS, DB
Cache indicates "Insufficient Balance".
Instead of failing, MS initiates JIT Hydration.
end note

MS -> HCM : GET /hcm/balances?employeeId=X&locationId=Y
HCM --> MS : 200 OK (Balance: 3 days)

note over HCM
Un-synced anniversary bonus discovered
end note

MS -> DB : UPSERT balance to 3 days (Hydration)

note over MS
Transaction re-evaluated against new state
end note

MS -> HCM : POST /hcm/time-off (amount: 2 days)
HCM --> MS : 201 Created
MS -> DB : UPDATE local balance to 1 day
MS --> UI : 200 OK (Approved, Remaining: 1 day)
@enduml

* **DTO Segregation for Domain Purity:** To strictly adhere to Clean Architecture, domain-level schemas and interfaces (located in `src/domain/schemas/index.ts`) are kept "plain" and free of infrastructure-specific metadata. Framework-specific decorators, such as NestJS validation (`@IsString`, `@IsNumber`) and Swagger documentation (`@ApiProperty`), are exclusively applied to dedicated classes within the **Presentation Layer** (`src/presentation/dtos`). These presentation DTOs implement the domain interfaces, effectively shielding the application core from HTTP framework dependencies and preventing "framework leakage" into the business logic.

## 7. Batch Reconciliation Plan

The `POST /sync/batch` endpoint acts as the system's self-healing mechanism, receiving the "whole corpus" of balances. However, applying a batch payload directly over a highly concurrent local cache introduces a severe race condition: **The In-Flight Transaction Conflict**.

**The Conflict:** The HCM generates a batch showing 10 days of leave for Employee A. While the batch is transmitting, Employee A requests 2 days via ExampleHR. The local cache updates to 8 days. Milliseconds later, the batch payload is processed. If we perform a naive overwrite, Employee A's balance resets to 10 days, erasing the 2-day deduction.

**The Resolution Strategy (Event Sourcing Delta Calculation):**
The local cache never unconditionally trusts a batch payload for active users. The reconciliation engine applies the following deterministic rule:
`Effective Local Balance = HCM Batch Balance - SUM(Unacknowledged Local Deductions)`

1. When a time-off request is approved locally but the batch hasn't accounted for it, the transaction is logged in `transaction_audit_logs` with a status of `PENDING_HCM_BATCH_ACK`.
2. When the batch payload arrives, the system queries the audit ledger for any pending deductions that occurred *after* the batch generation timestamp.
3. If the batch says 10 days, and the ledger shows a pending 2-day deduction, the system writes `8 days` to the `time_off_balances` table.
4. Once the HCM confirms it has processed the deduction on its end (via a subsequent batch or real-time response), the audit log entry is marked `RECONCILED`.

## 8. Observability & Exception Handling

Defensive programming dictates that we assume the HCM will frequently behave unpredictably. We utilize the **Adapter Pattern** at the infrastructure boundary to catch raw HTTP errors (e.g., Axios/Fetch exceptions) and translate them into predictable internal Domain Exceptions.

* **HCM_TIMEOUT (Upstream Outage):** * *Scenario:* The HCM crashes or times out while validating an in-flight request.
    * *Handling:* The Adapter catches the `ETIMEDOUT` and throws a `DependencyUnavailableException`. The microservice catches this, and if the local SQLite cache confirms the user has sufficient balance, we **Fail Open (Graceful Degradation)**. We approve the request for the user to maintain instant feedback, deduct the local balance, and queue the transaction in the `idempotency_keys` table with an `UNSYNCED` state for a background worker to push to the HCM once it recovers.
* **DIMENSION_MISMATCH (Invalid Location/Employee):**
    * *Scenario:* The UI sends a valid payload, but the HCM rejects it (e.g., location ID no longer exists).
    * *Handling:* The HCM returns an ambiguous 400 or 500. The Adapter parses the expected shape of the error, identifies the dimensional rule violation, and throws an `InvalidDimensionException`. The microservice translates this into an actionable `422 Unprocessable Entity` for the UI, explicitly detailing which dimension (e.g., `locationId: loc_456`) was rejected by the Source of Truth.

## 9. Test Strategy & HCM Mock Server Logic

The development lifecycle enforces strict **Test/Spec Driven Development (TDD/SDD)** using the F.I.R.S.T principles (Fast, Independent, Repeatable, Self-validating, Timely). 

* **Property-Based Testing for Concurrent Integrity**
To rigorously validate the system against the non-deterministic nature of the "In-Flight Transaction Conflict", the test suite incorporates **fast-check** for Property-Based Testing (PBT). Unlike traditional unit tests that rely on static, example-based inputs, PBT "bombards" the `TimeOffService` with hundreds of randomly generated concurrent deduction sequences. This allows the system to verify a fundamental domain invariant: `Initial Balance == Final Balance + SUM(Approved Deductions)`, regardless of the volume, frequency, or interleaving of asynchronous requests. This approach is critical for surfacing subtle race conditions within the local SQLite row-locking and idempotency logic that standard test suites would likely bypass.

* **Named Mock Classes:** We do not use inline dynamic stubs (e.g., `jest.fn().mockReturnValue(...)`) for architectural boundaries. We implement concrete, named mock classes (e.g., `HcmApiMockAdapter implements IHcmPort`) that contain actual state logic to simulate upstream behaviors reliably across the test suite.
* **Mock Server Logic - Mid-Transaction 500 Error:**
    * The test suite instantiates the mock server with an `injectFailureOnNextCall()` directive. 
    * *The Test:* The system sends a deduction request. The mock server processes the deduction internally but intentionally drops the connection or returns a `500 Internal Server Error` before responding.
    * *The Assertion:* The test validates that the microservice's retry mechanism uses the `Idempotency-Key`, ensuring that when the request is retried, the mock server recognizes the key and does not deduct the balance twice, returning the cached success response.
* **Mock Server Logic - Spontaneous Balance Increase:**
    * To test the JIT Hydration flow, the mock server exposes a hidden test method: `mockHcm.triggerAnniversaryBonus(employeeId)`.
    * *The Test:* The local SQLite DB is seeded with 0 days. The test calls the hidden method to bump the HCM mock balance to 1. The test then fires a time-off request for 1 day.
    * *The Assertion:* The test verifies that the system does not immediately return a 409 Conflict, but successfully intercepts the failure, queries the mock HCM, hydrates the local SQLite DB to 1, and successfully processes the 1-day request.

## 10. Alternative Analysis (Trade-offs)

1.  **TypeScript vs. Plain JavaScript:**
    * *Alternative:* Using Plain JS for faster initial setup and less boilerplate.
    * *Trade-off:* We lose compile-time validation of our external contracts. In a system where the HCM "does not guarantee" error responses, relying on JS runtime errors to catch malformed payloads is catastrophic. TypeScript's strict interfaces act as a zero-cost runtime documentation and structural guarantee, which is non-negotiable for system integrity.
2.  **Drizzle & SQLite vs. Prisma & SQLite:**
    * *Alternative:* Deploying SQLite instance managed by Prisma ORM.
    * *Trade-off:* Prisma is heavy, generating a massive Rust binary that inflates cold starts. By utilizing Drizzle (which is edge-compatible and runs SQL directly) alongside SQLite, we achieve sub-millisecond local reads, fulfilling the "Minimal APIs" and "Instant Feedback" mandates without the operational overhead of a standalone DB cluster.
3.  **Defensive Cache / JIT Hydration vs. 100% Synchronous Validation:**
    * *Alternative:* Dropping the SQLite cache entirely and making a synchronous HTTP call to the HCM for every single balance check and request.
    * *Trade-off:* While synchronous validation guarantees 100% data consistency, it creates a hard dependency on the HCM's uptime and latency. If the HCM takes 3 seconds to respond, ExampleHR's UI freezes for 3 seconds. The Defensive Cache + JIT Hydration trades a slight increase in architectural complexity (state management) for a massive gain in user experience (instant feedback) and system resilience (graceful degradation during outages).
4. **Opossum (Circuit Breaker) vs. Manual Timeout Logic:**
    * *Alternative:* Implementing per-request timeout handling using native `Promise.race` or Axios configuration.
    * *Trade-off:* Manual timeouts only address individual request latency and do not prevent "death by a thousand cuts" when an upstream service is systematically failing. **Opossum** provides a stateful Circuit Breaker that monitors the aggregate health of the HCM integration. By tracking error thresholds (e.g., 50% failure rate), Opossum can "open" the circuit to fail-fast immediately. This preserves local system resources, such as memory and event-loop cycles, and is a mandatory prerequisite for implementing the "Fail Open" resilience strategy, allowing the microservice to maintain high availability even during total upstream outages.