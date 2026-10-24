# ADR-002: PostgreSQL Schema Ownership, Multi-Layered Tenant Isolation, and Connection Budgeting Model

## Status
`Proposed`

## Date
2026-10-24 (Revised for Illustrative Connection Budget, Fail-Closed RLS Enforcement, and PgBouncer Compatibility)

## Decision Owner
Database Architect / Security Lead

---

## 1. Context

The platform is a multi-tenant SaaS serving independent grocery merchants. Every merchant's store catalog, stock balances, customers, orders, financial records, and operational reports must be strictly isolated from other merchants.

The architecture specifications mandate:
- Each service must own its write data; direct table access across service boundaries is prohibited.
- For a first release, services may share a PostgreSQL cluster but must use isolated databases or schemas with least-privilege roles (Spec v2.0 §4, Baseline v3.0 §3–4).
- Tenant identity must always be derived from a verified authentication context or verified provider webhook mapping, never from an untrusted client parameter (Spec v2.0 §4, Baseline v3.0 §4).
- Tenancy and data isolation must be enforced from **Day 1 (Phase 2)**. Security and tenant isolation cannot be deferred to a late hardening phase.

In the target **Render** deployment:
- Render Postgres provides managed PostgreSQL 16 instances.
- **The actual Render plan, current effective connection limits, pooling configuration, and observed peak usage are UNCONFIRMED until checked against the selected plan and measured in staging.**

---

## 2. Mandated Requirements from Approved Specifications

- **Trusted Tenant Context:** Never authorize access from a `store_id` or `tenant_id` supplied by a browser, URL parameter, or request header alone. The store context must come from a verified cryptographic session/JWT token or a verified webhook mapping (Spec v2.0 §4, Baseline v3.0 §4).
- **Service Data Ownership:** A service may read and write only its own tables. No cross-service foreign keys are allowed (Spec v2.0 §4, Baseline v3.0 §3).
- **ACID Transaction Scope:** Transactions are strictly local to a single service database/schema. No distributed two-phase commit (2PC) transactions across service boundaries (Spec v2.0 §7, Baseline v3.0 §1).
- **Tenant Isolation Verification:** Automated regression tests must verify that Store A users cannot read, mutate, or export Store B data across any endpoint (Baseline v3.0 §4).

---

## 3. PostgreSQL Strategy: Schema-per-Service on Shared Instance

### 3.1 Logical Isolation vs. Shared Infrastructure Failure Domain
We formally standardize on **Schema-per-Service on a single managed Render Postgres 16 instance** for initial launch.

> **CRITICAL ARCHITECTURAL DISTINCTION:**  
> Schema-per-service establishes **strict logical boundaries and role-based access control**, but it **DOES NOT provide physical infrastructure isolation**. All services share the same PostgreSQL CPU, memory, disk I/O, backup window, and global connection pool. A runaway query in Reporting or a crash in the PostgreSQL instance affects all services simultaneously. True physical isolation requires independent database servers, which is a future migration path when traffic justifies it.

### 3.2 Schema Boundaries and Least-Privilege Database Roles
Each domain service owns its schema and connects using dedicated database credentials with least-privilege grants:

| Schema | Owning Service / Component | Dedicated Database Role | Permitted Table Operations | Cross-Schema Grants |
| :--- | :--- | :--- | :--- | :--- |
| `identity` | `identity-service` | `grocery_identity_user` | `SELECT, INSERT, UPDATE, DELETE` on `identity.*` | **NONE** (Revoke all on other schemas) |
| `catalog` | `catalog-service` | `grocery_catalog_user` | `SELECT, INSERT, UPDATE, DELETE` on `catalog.*` | **NONE** |
| `inventory` | `inventory-service` | `grocery_inventory_user` | `SELECT, INSERT, UPDATE, DELETE` on `inventory.*` | **NONE** |
| `order` | `order-service` | `grocery_order_user` | `SELECT, INSERT, UPDATE, DELETE` on `order.*` | Read/Write to `billing.*` (co-located) |
| `billing` | `order-service` (Billing module)| `grocery_order_user` | `SELECT, INSERT, UPDATE, DELETE` on `billing.*` | Read/Write to `order.*` |
| `payment` | `payment-service` | `grocery_payment_user` | `SELECT, INSERT, UPDATE, DELETE` on `payment.*` | **NONE** |
| `notification`| `notification-worker` | `grocery_notification_user` | `SELECT, INSERT, UPDATE, DELETE` on `notification.*`| **NONE** |
| `reporting` | `reporting-worker` | `grocery_reporting_user` | `SELECT, INSERT, UPDATE, DELETE` on `reporting.*` | **NONE** |

**DDL Ownership vs. Runtime Access Roles:**
- **DDL Migration Role (`grocery_migrator`):** Super-user or schema owner role used exclusively during CI/CD migration runs. Owns table creation, index alterations, and schema migrations.
- **Runtime Service Roles (`grocery_*_user`):** Granted strictly `DML` privileges (`SELECT, INSERT, UPDATE, DELETE`).
- **Non-RLS Operations Revocation:** Table-level operations not governed by Row-Level Security, such as `TRUNCATE`, are **explicitly revoked** from runtime roles (`REVOKE TRUNCATE ON ALL TABLES IN SCHEMA ... FROM grocery_*_user`).
- **No Superuser or Bypass:** Runtime service roles must **never** be superusers, table owners, or have `BYPASSRLS`.

---

## 4. Database Connection-Budget Model

### 4.1 Connection Layer Definitions
To eliminate architectural ambiguity, connection types must be distinguished:
1. **Application/Client Pool Connections:** Sockets opened by the Node.js process pools (Prisma, pg, or Kysely).
2. **PgBouncer Client Connections:** Incoming client connections accepted by PgBouncer (which can support thousands of idle sockets).
3. **PgBouncer Server Connections:** Active PostgreSQL server backends maintained by PgBouncer to multiplex client transactions.
4. **Direct PostgreSQL Connections:** Connections that completely bypass PgBouncer (such as migration runners requiring DDL locks, or DBA administrative/diagnostics tools).

### 4.2 Calculation Model & Overlapping Deployments
The total direct connection demand is calculated as:
$$\text{Peak Direct Demand} = \sum_{i} \left( \text{MaxProcesses}_i \times \text{PoolMax}_i \right) + \text{DirectMigrationConns} + \text{AdminReserve}$$

Where $\text{MaxProcesses}_i$ accounts for **overlapping rolling deployments** (e.g. during a zero-downtime Render deployment, new containers spin up and acquire database connections *before* old containers finish draining and exit).

### 4.3 Illustrative Connection Demand Scenarios (Under Explicit Assumptions)
The numbers below are **illustrative direct-connection demand calculations under explicit assumptions**, not verified capacity or a confirmed Render plan limit:

```text
Component / Service                  Pool Max (P)  Baseline (1 Proc) Overlapping Deploy (2 Procs)
─────────────────────────────────────────────────────────────────────────────────────────────────
apps/api-gateway                     0             0 connections     0 connections (Stateless)
apps/identity-service                max: 5        5 connections     10 connections
apps/catalog-service                 max: 5        5 connections     10 connections
apps/inventory-service               max: 5        5 connections     10 connections
apps/order-service (incl. Billing)   max: 5        5 connections     10 connections
apps/payment-service                 max: 5        5 connections     10 connections
apps/notification-worker             max: 3        3 connections     3 connections (Worker)
apps/reporting-worker                max: 3        3 connections     3 connections (Worker)
apps/reconciliation-worker           max: 3        3 connections     3 connections (Worker)
CI / Migration Runner (Direct)       max: 5        5 connections     5 connections
DBA / Operational Reserve (Direct)   max: 10       10 connections    10 connections
─────────────────────────────────────────────────────────────────────────────────────────────────
ILLUSTRATIVE DIRECT CONNECTION DEMAND:             49 connections    76 connections
```

- **Gateway Assumption:** The Gateway’s zero database connection allocation is an architectural assumption that holds **only while the Gateway remains completely database-independent**. If session storage or rate limiting is moved to PostgreSQL, the Gateway must be allocated its own pool.
- **Unconfirmed Plan Limit:** Render Starter tier typically defaults to `max_connections = 100` (leaving ~97 for non-superusers), but the actual limit, pooling configuration, and server connection ceilings must be confirmed upon plan selection.
- **Safety Reserve Rule:** A minimum safety reserve of 20 connections must be preserved for admin, diagnostics, and sudden bursts. No service replica scaling may be enabled in production until the actual budget is validated against the active plan.

### 4.4 PgBouncer & Prepared-Statement Compatibility Guidance
- Compatibility with PgBouncer Transaction Pooling depends on the specific database driver, ORM, pooler version, and supported configuration.
- We **do not unconditionally mandate disabling prepared-statement caching across every ORM**. For example, while traditional named prepared statements collide in transaction pooling, certain ORMs (such as Prisma with `?pgbouncer=true` or pg-promise with unnamed prepared statements) have specific integration mechanisms.
- **Phase 1 Verification Gate:** Compatibility between the chosen ORM/driver, prepared statements, and Render PgBouncer must be verified through automated integration tests in staging during Phase 1 before finalizing database client setup.

---

## 5. Implementable Multi-Layered Tenant-Isolation Contract

Tenant isolation is achieved through **four complementary controls**. None of these controls is considered sufficient on its own:
1. **Database Schema Permissions:** Runtime roles have no access to unauthorized schemas.
2. **Application Authorization:** Service checks caller permissions against requested resource ownership.
3. **Application Query Scoping:** Every query explicitly parameterizes `WHERE store_id = $context.tenantStoreId`.
4. **Row-Level Security (RLS) Defense-in-Depth:** Enforced at the PostgreSQL engine level.

### 5.1 Explicit Classification of Tenant-Owned Tables
Every table in the database is explicitly classified:
- **Tenant-Owned Tables:** All operational and business entities (e.g. `catalog.products`, `catalog.product_variants`, `inventory.stock_balances`, `inventory.stock_movements`, `order.orders`, `order.order_items`, `billing.invoices`, `payment.payment_attempts`). **Must have `store_id UUID NOT NULL` and active RLS.**
- **Shared / Reference Tables:** Global system tables (e.g. `catalog.canonical_units`, `identity.system_roles`). Read-only for standard runtime roles; no tenant scoping required.

### 5.2 Tenant-Context Input Validation & Controlled Application Error Handling
Before any database transaction is initiated or transaction-local context is established, the application must rigorously validate the tenant context:
1. **Canonical Identifier Validation:** The tenant identifier must be strictly validated as a canonical RFC 4122 UUIDv4 (36-character hexadecimal format with hyphens). Malformed strings, non-UUID types, empty strings, and injection payloads are rejected at the application boundary prior to acquiring a database connection.
2. **Controlled Error Responses (RFC 9457):**
   - *Missing Context:* If an endpoint requires tenant context and none is provided or resolved: reject with `401 Unauthorized`.
   - *Malformed Identifier:* If the tenant identifier fails canonical UUID syntax validation: reject with `400 Bad Request` (`code: INVALID_TENANT_IDENTIFIER`).
   - *Unauthorized Store Membership:* If the authenticated user or token lacks active membership or permissions for the specified store: reject with `403 Forbidden` (`code: TENANT_ACCESS_DENIED`).
   - *Resource Tenant Mismatch:* If the requested resource (e.g., `/orders/{id}`) belongs to a store other than the validated tenant context: return `404 Not Found` (or `403 Forbidden`) to prevent cross-tenant enumeration.
3. **No Unrestricted Fallback:** Under no circumstances may missing, empty, malformed, or unauthenticated tenant context fall back to global, shared, or unrestricted access.

### 5.3 RLS Policy Definition & Fail-Closed Behavior
RLS must be enabled on all tenant-owned tables and forced on table owners to prevent administrative bypass during application connections:
```sql
ALTER TABLE catalog.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog.products FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON catalog.products
FOR ALL
USING (
  store_id = NULLIF(current_setting('app.current_store_id', true), '')::uuid
)
WITH CHECK (
  store_id = NULLIF(current_setting('app.current_store_id', true), '')::uuid
);
```

**Why This Fails Closed:**
- If `app.current_store_id` is missing, uninitialized, empty string `''`, or invalid, `current_setting('...', true)` returns `NULL` or empty, `NULLIF` evaluates to `NULL`, and `store_id = NULL` evaluates to SQL `UNKNOWN`.
- Reads return **zero rows**. Inserts, updates, and deletes fail with an RLS check violation. It **never falls back to unrestricted access**.

### 5.4 Transaction-Local Boundary, Pooler Safety & Isolation Scope
- **Derivation:** Tenant context must be derived strictly from trusted, cryptographically validated token context (`X-Internal-Token.tid`), never from raw, unverified client headers.
- **Explicit Transaction Lifecycle:** Setting tenant context and executing queries must occur within the **exact same explicit transaction block**:
  ```sql
  BEGIN;
  -- Parameterized call sets setting local to this transaction only:
  SELECT set_config('app.current_store_id', $1, true); 
  -- All protected queries execute within this explicit transaction
  SELECT * FROM catalog.products WHERE store_id = $1;
  COMMIT;
  ```
- **Pooler Safety:** Passing `true` as the third parameter to `set_config` (or using `SET LOCAL`) guarantees that PostgreSQL discards the setting automatically upon `COMMIT` or `ROLLBACK`. This prevents context leakage across transactions when PgBouncer reassigns the server connection to a different client.
- **Multi-Layered Isolation Disclaimer:** The SQL RLS expression alone does **not** guarantee all aspects of tenant isolation. RLS is a defense-in-depth safety net, not a replacement for application-level authorization. Complete isolation requires:
  1. Runtime database roles (`grocery_*_user`) stripped of `BYPASSRLS`, table ownership, and `TRUNCATE` privileges.
  2. DDL migrations executed exclusively by a separate `grocery_migrator` role.
  3. Strict application query scoping (`WHERE store_id = $1`) as the primary filter.
  4. Explicit API authorization validating store membership and resource ownership.
- **PgBouncer Compatibility Test:** During Phase 1, staging tests must explicitly verify that `set_config(..., true)` operates reliably with Render PgBouncer transaction pooling. If transaction-local context cannot work reliably with the chosen pooler, this must be recorded as a blocking design issue.

---

## 6. Testing, Audit, and Acceptance Criteria

Isolation cannot be claimed as proven before the following automated tests pass:
- **Cross-Tenant CRUD Test Gate (Phase 2):** Automated test creates Store A and Store B. Attempting to execute `SELECT`, `INSERT`, `UPDATE`, or `DELETE` against Store B records using Store A context must fail or affect 0 rows.
- **Missing/Malformed Context Test Gate:** Execute queries with empty, malformed, or missing `app.current_store_id`; verify zero rows returned and mutations blocked.
- **Runtime Role Privilege Test Gate:** Execute `SELECT * FROM order.orders` using `grocery_catalog_user`; verify PostgreSQL returns `permission denied for schema order`.
- **Non-RLS Operation Test Gate:** Attempt `TRUNCATE catalog.products` as `grocery_catalog_user`; verify permission denied.
- **Table Audit Gate:** CI pipeline verifies that any new migration adding a tenant-owned table includes `store_id UUID NOT NULL` and `ENABLE/FORCE ROW LEVEL SECURITY`.

---

## 7. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md).
- **Successor:** [ADR-003](./ADR-003-authentication-and-identity-linking.md), [ADR-007](./ADR-007-order-review-and-inventory-reservation.md), [ADR-008](./ADR-008-hosting-secrets-backups-and-recovery.md).

---

## 8. Explicit Owner Approval Required

- **Database Architect & Security Lead:** Approval of the illustrative connection budget, schema ownership boundaries, fail-closed RLS design, and PgBouncer compatibility verification gate.

---

## 9. Unresolved Questions

1. Which specific Render Postgres plan (Starter: $7/mo vs Standard: $50+/mo) will be approved for staging and production?
2. Does the selected ORM/driver cleanly support `SET LOCAL app.current_store_id` in transaction blocks over PgBouncer, or is explicit query parameterization preferred as the sole operational control?
