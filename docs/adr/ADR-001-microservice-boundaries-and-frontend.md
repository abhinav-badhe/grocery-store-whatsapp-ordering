# ADR-001: Microservice Boundaries, Monorepo Architecture, Vercel + Render Topology, and Internal Security Contract

## Status
`Proposed`

## Date
2026-10-24 (Revised for 3-Part Identity Model, Asymmetric vs. Symmetric Trade-offs, and Webhook Trust Boundaries)

## Decision Owner
System Architect / Technical Steering Committee

---

## 1. Context

The Grocery Store Management and WhatsApp Ordering System is a multi-tenant platform serving independent grocery stores. To manage operational complexity and rapid delivery while satisfying the approved specifications, the platform requires clear service boundaries, consistent inter-service communication protocols, and a defined deployment topology.

The intended production infrastructure combines:
- **Frontend:** Hosted on **Vercel**, utilizing Next.js App Router.
- **Backend Application Services & Workers:** Hosted on **Render**, utilizing Render's native service primitives (Web Services, Private Services, Background Workers).
- **Persistent Data:** Managed PostgreSQL (Render Postgres, specific plan and connection capacity unconfirmed).
- **Asynchronous Messaging:** RabbitMQ (CloudAMQP or dedicated container, proposed pending budget approval).

An audit of the repository identified two architectural alignments:
1. `Grocery_Store_Production_Architecture_Final_Specification_v2.pdf` (Table 3) lists `React + TypeScript + Vite`, but explicitly defers to `STYLE.md` (*"follow the project's style.md if one exists"*). `STYLE.md` strictly mandates **Next.js (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui**. Next.js on Vercel is the natural, state-of-the-art match.
2. Specification v2.0 (§4–5) lists 10 separate logical services, while Baseline v3.0 (§3–4) introduces a pragmatic constraint: *"Billing can initially be a module within Order if the team cannot yet operate a separate service... Keep a service separate when it needs independent ownership, scaling, security or release cadence—not just to increase the service count."*

---

## 2. Mandated Requirements from Approved Specifications

- **Frontend Precedence:** Spec v2.0 explicitly defers frontend UI decisions to `STYLE.md` when present (*"follow the project's style.md if one exists"*).
- **Service Boundaries:** Web Frontend, API Gateway, Identity, Catalog, Inventory, Order, Payment, Billing, Notification, and Reporting services must be recognized (Spec v2.0 §4, Baseline v3.0 §3).
- **Data Ownership Invariant:** Every domain service owns its write data. No service may read or write another service's private database tables directly. No cross-service foreign keys are permitted (Spec v2.0 §4, Baseline v3.0 §3).
- **Communication Direction:** Synchronous REST calls are permitted only downstream (`Web -> Gateway -> Domain APIs`, `Order -> Catalog`, `Order -> Inventory`). Circular synchronous calls are strictly prohibited. Asynchronous business events flow via RabbitMQ (Spec v2.0 §4, Baseline v3.0 §3).

---

## 3. Options Considered

### A. Frontend Platform
- **Option A1 (Vercel with Next.js App Router - Proposed):** Deploy Next.js to Vercel. Global edge CDN, automatic HTTPS, preview environments on pull requests, native React Server Component optimization, and zero cold starts for static routes.
- **Option A2 (Render Web Service for Frontend):** Containerize Next.js and run as a standard Render Web Service. Increases Render instance costs and loses Vercel's global edge network.

### B. Render Backend Service Topology & Deployable Count
- **Option B1 (10 Standalone Public Render Web Services):** Deploy each microservice as an independent public Render Web Service. (Rejected: excessive instance costs, excessive connection pools, and exposes internal microservices to the public internet).
- **Option B2 (Reconciled Deployable Topology: 1 Public Web Service + 5 Private Services + 3 Background Workers - Proposed):**
  - **API Gateway (1 Web Service - Public Ingress):** Single public entry point. Handles edge rate limits, TLS termination, request ID injection, public header stripping, and internal token assertion. **Architectural assumption:** Assumes zero database connections only as long as the Gateway remains purely stateless and database-independent.
  - **Core Domain Services (5 Private Services - Internal):** `identity-service`, `catalog-service`, `inventory-service`, `order-service` (hosting co-located Billing module), and `payment-service`. Accessible *exclusively* over Render's internal private network (`*.render.internal`). Zero public internet routing.
  - **Asynchronous Workers (3 Background Workers - Daemons):** `notification-worker`, `reporting-worker`, and `reconciliation-worker`. Long-running queue consumers and scheduled maintenance jobs with zero open HTTP ports.
- **Option B3 (Monolithic Single Container on Render):** Bundle all services into one single process. (Rejected: violates required microservice boundaries).

### C. Internal Service Authentication Mechanism
- **Option C1: Shared Symmetric HMAC Secret (`HS256`):**  
  Gateway and all private services share an `INTERNAL_SERVICE_SECRET`. Gateway (and caller services) sign an `X-Internal-Token` header.
  - *Trust Trade-off:* Any service possessing the shared secret has the technical capability to forge tokens claiming to be the Gateway or any user/tenant. Requires strict operational trust across all backend services.
- **Option C2: Asymmetric Cryptographic Signing (`EdDSA` / `RS256` - Recommended for Production):**  
  API Gateway (and Identity Service) holds the private signing key. Downstream private services hold only the corresponding public verification key.
  - *Trust Trade-off:* Downstream services can verify tokens but cannot forge them. Prevents a compromised downstream service (e.g. Catalog) from forging identity assertions for Order or Payment.
- *Status:* Both options documented as **Proposed**; Option C1 acceptable for Phase 1 local baseline, Option C2 recommended for staging/production hardening.

---

## 4. Reconciled Deployable Topology Manifest on Render

```text
Platform: VERCEL
└── apps/web (Next.js App Router, SSR/RSC, shadcn/ui, Tailwind v4)
      │
      │ Public HTTPS REST calls (CORS protected, rate limited)
      ▼
Platform: RENDER
├── [Public Web Service - Public Ingress]
│     └── apps/api-gateway (Runtime port: process.env.PORT, Public TLS, Strips X-Internal-* headers)
│           │
│           │ Private Network HTTP (http://<service-name>.render.internal:$PORT)
│           │ Authenticated via signed X-Internal-Token (Service ID + User ID + Tenant Context)
│           ├──► apps/identity-service   [Private Service: $PORT]
│           ├──► apps/catalog-service    [Private Service: $PORT]
│           ├──► apps/inventory-service  [Private Service: $PORT]
│           ├──► apps/order-service      [Private Service: $PORT] (includes co-located Billing module)
│           └──► apps/payment-service    [Private Service: $PORT]
│
├── [Background Workers - Daemon Compute, Zero Ingress Ports]
│     ├── apps/notification-worker       [Background Worker] (Consumes RabbitMQ, calls Meta API)
│     ├── apps/reporting-worker          [Background Worker] (Consumes RabbitMQ, updates projections)
│     └── apps/reconciliation-worker     [Background Worker] (Outbox publisher, saga/payment cron)
│
└── [Managed Persistence & Messaging]
      ├── Render PostgreSQL 16 (Single instance with schema-per-service + PgBouncer pooling)
      └── CloudAMQP / Managed RabbitMQ (Proposed, pending budget approval)
```

**Runtime Port Binding Requirement:**  
Node.js processes must bind dynamically to `process.env.PORT` provided by Render at runtime. Public TLS termination on 443 is a platform capability of the Render reverse proxy, not the application container.

---

## 5. Three-Part Internal Authentication & Authorization Contract

To ensure security across the boundary between the API Gateway and internal Private Services, the platform explicitly separates three distinct concepts:
1. **Service Identity:** Which backend workload or process is making the immediate request (e.g., caller is `api-gateway` or `order-service`).
2. **End-User Identity:** Which authenticated human actor or external provider initiated the transaction (e.g., customer `usr_cust123`, shopkeeper `usr_stf456`, or system `system:webhook`).
3. **Tenant and Resource Authorization:** Whether that authenticated identity is permitted to execute the requested operation against the specified store and resource.

### 5.1 Public Ingress Credential Handling & Sanitization Sequence
The API Gateway sits at the untrusted network perimeter and executes a strict 5-stage request-processing sequence:

1. **Receive External Request:** Edge ingress via public HTTPS.
2. **Authenticate & Validate External Credentials:** The Gateway validates incoming client credentials according to the route and client classification:
   - *Web Sessions (Next.js frontend):* Validates HttpOnly, Secure, SameSite session cookies via the Identity Service / session store.
   - *Mobile / Direct API Clients:* Validates standard HTTP `Authorization: Bearer <token>` credentials.
   - *External Webhook Integrations (Meta WhatsApp, Payment Provider):* Validates provider-specific cryptographic signatures (`X-Hub-Signature-256`, webhook signature headers) over the raw, unparsed request payload.
   *(Note: Public authentication credentials are evaluated during this step; they are never stripped prior to authentication.)*
3. **Strip & Overwrite Untrusted Client-Supplied Internal Headers:** The Gateway unconditionally removes or overwrites any incoming headers that mimic internal trust headers, including `X-Internal-*`, `X-Caller-*`, `X-Forwarded-User`, client-supplied roles, or client-supplied tenant identifiers (`store_id`/`tenant_id`). Client-supplied internal headers are never forwarded downstream or used as trusted claims. Public authentication credentials (cookies, Bearer tokens) are consumed at the Gateway and are not forwarded to private backend services.
4. **Construct Trusted Downstream Identity Context:** Only upon successful external authentication and authorization, the Gateway constructs a trusted downstream identity context (`sub`, `act`, validated canonical `tid`, store-scoped `roles`). If authentication fails, the Gateway fails closed immediately with `401 Unauthorized` (RFC 9457) and does not proxy the request.
5. **Forward Intended Assertion & Permitted Metadata:** The Gateway mints and forwards the trusted internal assertion (`X-Internal-Token`) alongside strictly permitted request metadata:
   - `X-Request-ID` (UUID correlation ID)
   - `X-Forwarded-For` (client IP trace)
   - `Idempotency-Key` (client-supplied idempotency key, where applicable)
   - Raw request body (for verified webhooks)

### 5.2 Internal Token Claims Specification
Downstream service calls carry a signed JWT structured as:
```json
{
  "iss": "api-gateway",
  "aud": "grocery-internal-service",
  "sub": "usr_987654321",
  "act": "SHOPKEEPER",
  "tid": "str_123456789",
  "roles": ["STAFF", "ORDER_MANAGER"],
  "jti": "nonce_a1b2c3d4e5f6",
  "iat": 1729760000,
  "nbf": 1729760000,
  "exp": 1729760060
}
```

- **Per-Request Minting & Lifespan:** The Gateway issues a fresh, single-request token for each outbound downstream call (scoped to `aud: <service-name>`) with a short 60s TTL.
- **Service-to-Service Calls:** When an internal service calls another internal service directly (e.g. `order-service` calling `catalog-service` to validate SKUs), the caller mints its own fresh token with `iss: order-service`, `aud: catalog-service`, a new unique `jti`, and 60s TTL, while propagating the verified user context in `sub` and `tid`.
- **Internal Retries & Timeouts:** If an internal call times out or encounters a transient 503 error, any internal retry **must mint a fresh token with a new unique `jti`** for each retry attempt. This ensures legitimate internal retries are not rejected as replayed nonces by the receiving service. The original client `Idempotency-Key` is preserved across all attempts.

### 5.3 Cryptographic Verification & Error Behavior
1. **Issuer & Audience Validation:** The receiving service verifies that `iss` matches an approved caller service (`api-gateway` or `order-service`) and `aud` matches its service name or `"grocery-internal-service"`.
2. **Algorithm Allowlist:** Strictly enforced allowlist (e.g. `['HS256']` for symmetric, or `['EdDSA', 'RS256']` for asymmetric). Tokens specifying `"alg": "none"` or unapproved algorithms are rejected immediately.
3. **Key Identifier & Rotation (`kid`):** Token headers must include `kid` (e.g. `kid: "internal-key-2026-1"`). Services maintain active and previous rotating keys to permit zero-downtime key rotation.
4. **Clock Tolerance:** Verification applies a bounded clock tolerance of **at most 5 seconds** (`clockTolerance: 5`).
5. **Fail-Closed Policy:** If the internal token is missing, expired, signed with an unknown `kid`, fails signature verification, or targets an invalid audience, services **must fail closed immediately, returning `401 Unauthorized` or `403 Forbidden` with RFC 9457 Problem Details**. Downstream services **never** fall back to unauthenticated processing.

### 5.4 Replay Mitigation vs. Business-Operation Idempotency
The architecture explicitly separates request replay prevention from business-operation idempotency:

1. **Request Replay Checking (`jti` in Redis / In-Memory Store):**
   - *Purpose:* Detects malicious wire replay of an intercepted `X-Internal-Token` within its 60-second TTL.
   - *Target Operations:* Evaluated on sensitive state-mutating operations (checkout, payment capture, refund, stock adjustment). Safe/idempotent `GET` queries bypass `jti` replay tracking.
   - *Redis Outage Behavior (Proposed):* If the Redis replay store is unreachable, financial and payment-capture mutations fail closed (`503 Service Unavailable / ReplayStoreUnavailable`); non-financial operations may fall back to an in-process LRU cache with an operational alert.
2. **Business-Operation Idempotency (`Idempotency-Key` in PostgreSQL):**
   - *Purpose:* Protects against duplicate business logic execution (double orders, duplicate billing, double inventory deductions) resulting from client double-clicks, network retries, or message redelivery.
   - *Strict Scoping:* Idempotency records in PostgreSQL are strictly scoped by:
     `tenant_id` + `user_id` + `endpoint_operation` + `idempotency_key`
   - *Payload Hash Verification:* The record stores `SHA-256(request_body)`. If a subsequent request arrives with an identical key but mismatched payload hash, the service returns `422 Unprocessable Entity` (or `400 Bad Request`).
   - *Concurrent Serialization:* The initial request inserts an idempotency row with status `PROCESSING` within the database transaction. A concurrent request with the identical key encounters a unique constraint violation and either waits on a row lock or receives `409 Conflict` (or `425 Too Early`), preventing dual concurrent processing. Once the initial request commits, the final HTTP status code and response body are persisted (`status: COMPLETED`), and subsequent identical requests return the cached response without re-executing business logic.
3. **Non-Guarantee Disclaimer:** The presence of `jti`, Redis, or an `Idempotency-Key` header does not automatically guarantee replay prevention or exactly-once execution. They are engineering patterns requiring strict transaction isolation, persisted stores, and automated verification under concurrent load. Messaging broker redeliveries are deduplicated via consumer inbox (`inbox_events`) using message IDs, distinct from HTTP idempotency keys.

### 5.5 Prohibition on Blind Trust of Token Claims & Tenant Context Validation
A receiving service must **never authorize a request solely because a signed token contains a `tid` or `roles` claim**:
- **Tenant Context Input Validation:** The tenant identifier `tid` must be validated as a canonical RFC 4122 UUIDv4 before initiating any database transaction or setting context. Malformed tenant context returns `400 Bad Request`; unauthorized store context returns `403 Forbidden`.
- **Resource Ownership Validation:** When an order or invoice endpoint `/orders/{orderId}` is called, the service verifies that the resource requested actually belongs to the store specified by `tid`.
- **Permission Mapping:** The service validates that the permissions associated with `roles` authorize the specific action (e.g., role `STAFF` cannot execute `REFUND_ORDER`).

---

## 6. Consequences and Trade-offs

- **Positive:** Mathematically prevents BOLA/IDOR; eliminates header-spoofing attacks from the public internet; cleanly separates service caller identity, end-user identity, and tenant authorization.
- **Negative:** Requires secure distribution and rotation of signing keys; asymmetric signing is recommended to eliminate symmetric key minting risks.

---

## 7. Testing and Acceptance Criteria

- **Gateway Header Stripping Test Gate:** Send external request with `X-Internal-Token: forged`; verify the Gateway strips it and generates a genuine signed token based on authenticated credentials.
- **Token Tampering Test Gate:** Modify 1 character of the signature on an internal request; verify internal service returns `401 Unauthorized`.
- **Expired Token Test Gate:** Submit an internal token with `iat/exp` generated 65 seconds ago; verify internal service returns `401 Unauthorized (TokenExpired)`.
- **Tenant Scope Mismatch Test Gate:** Submit token for Store A attempting to access a Store B resource; verify internal service rejects with `403 Forbidden`.

---

## 8. Dependencies

- **Predecessor:** None.
- **Successor:** [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md), [ADR-008](./ADR-008-hosting-secrets-backups-and-recovery.md).

---

## 9. Explicit Owner Approval Required

- **System Architect & Security Lead:** Approval of the 3-part identity contract, `HS256` vs. `EdDSA` signing option selection, and token replay/idempotency safeguards.

---

## 10. Unresolved Questions

1. Should asymmetric key pairs (`Ed25519` / `EdDSA`) be implemented from Day 1 in Phase 1, or should symmetric `HS256` with `kid` be used initially? (Symmetric is simpler for Day 1; asymmetric eliminates shared-secret forgery risks).
