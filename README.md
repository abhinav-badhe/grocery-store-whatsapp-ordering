# Grocery Store & WhatsApp Ordering Monorepo

Welcome to the **Grocery Store Management & WhatsApp Ordering System** monorepo. This repository houses the Next.js frontend, microservices backend, background workers, and shared contract packages.

> **CRITICAL SECURITY NOTICE:**  
> Never commit real secrets, private keys, database credentials, API tokens, or production URLs to version control. Real `.env` files are excluded by `.gitignore`.

---

## 1. Current Phase & Implementation Status

- **Phase 0:** Complete and audited. Architecture Decision Records (`docs/adr/`) and system overviews (`docs/architecture/`) are documented. All ADRs remain in `Proposed` status pending decision-owner sign-off.
- **Phases 1–11 (Completed & Verified):**
  - **Toolchain & Shared Foundation:** TypeScript configurations, ESLint, API/Event contracts, and structured Pino observability across all 19 workspace projects.
  - **Relational Persistence:** Multi-tenant Kysely PostgreSQL migrations with strict schema-prefixed isolation (`identity`, `catalog`, `inventory`, `order`, `payment`, `events`).
  - **Domain Microservices:** `identity-service`, `catalog-service`, `inventory-service`, `order-service`, and `payment-service`.
  - **Asynchronous Workers:** `notification-worker` (multi-channel transactional outbox), `reconciliation-worker` (stock release & stale payment cleanup), and `reporting-worker` (sales & stock health projections).
  - **Ingress & Client Applications:** `api-gateway` (credentialed CORS, rate limiting, internal token minting, reverse proxy) and `web` (customer storefront, unit conversion, cart domain).
  - **Verification:** 100% test pass rate across all workspace projects (466 passing tests), 100% clean typecheck (`tsc --noEmit`), and 100% Prettier formatting compliance.

---

## 2. Prerequisites & Environment

Before developing locally, ensure the following tools are installed:

- **Node.js:** `>=20.18.0` (Host verified with `v24.16.0`)
- **pnpm:** `12.6.0` (Pinned via `packageManager` in `package.json`)
- **Docker & Docker Compose:** Required only for running local backing infrastructure (PostgreSQL 16, RabbitMQ 3.13, Redis 7)

### Windows-Compatible Command Note

On Windows systems where PowerShell script execution policy restricts `.ps1` files, invoke `pnpm` using `cmd /c pnpm` or `pnpm.cmd`:

```cmd
cmd /c pnpm install
cmd /c pnpm run format:check
```

### Local Development Infrastructure (Docker Compose)

For local development and testing, backing services can be run via `docker-compose.yml`:

```bash
# Start local backing infrastructure (binds strictly to loopback 127.0.0.1)
docker compose up -d

# Check service health and container status
docker compose ps

# Stop local infrastructure
docker compose down

# Stop and wipe persistent development volumes
docker compose down -v
```

#### Service Addressing and Port Conventions

- **Host Access (Loopback Only):** Developer host tools, IDE extensions, database GUIs, and local test runners connect via loopback:
  - PostgreSQL: `127.0.0.1:5432` (`postgres` / `postgres`)
  - RabbitMQ AMQP: `127.0.0.1:5672` (`grocery_dev` / `grocery_dev_password`)
  - RabbitMQ Management UI: `http://127.0.0.1:15672`
  - Redis: `127.0.0.1:6379`
- **Inter-Service Communication (Compose Network):** When containerized services communicate across the Docker network (`grocerystore_local_dev_net`), they must use the **internal service hostname and standard container port** rather than the host-published loopback port:
  - PostgreSQL: `postgres:5432`
  - RabbitMQ AMQP: `rabbitmq:5672` (using the dedicated `grocery_dev` credentials; the default `guest` account is disabled for non-loopback connections by RabbitMQ policy)
  - Redis: `redis:6379`

> **LOCAL DEVELOPMENT ONLY:** `docker-compose.yml` is strictly configured for local testing and binds exclusively to loopback (`127.0.0.1`). It must never be used for staging or production deployment. Production topology is governed by the Render Blueprint and Vercel edge configuration.

---

## 3. Planned Monorepo Layout

When fully scaffolded in Phase 1, the repository will be structured as follows:

```text
apps/
  web/                     # Frontend UI (Next.js App Router, Tailwind v4, shadcn/ui per STYLE.md)
  api-gateway/             # Public Ingress Web Service on Render ($PORT, public HTTPS)
  identity-service/        # Render Private Service ($PORT)
  catalog-service/         # Render Private Service ($PORT)
  inventory-service/       # Render Private Service ($PORT)
  order-service/           # Render Private Service ($PORT, includes Billing module)
  payment-service/         # Render Private Service ($PORT)
  notification-worker/     # Render Background Worker (RabbitMQ consumer, WhatsApp dispatch)
  reporting-worker/        # Render Background Worker (RabbitMQ consumer, analytics)
  reconciliation-worker/   # Render Background Worker (Outbox publisher, payment reconciliation)

packages/
  tsconfig/               # Shared TypeScript configurations
  eslint-config/           # Shared ESLint configurations
  api-contracts/           # Shared Zod schemas, DTOs, and error types
  event-contracts/         # Shared RabbitMQ event schemas and routing keys
  observability/           # Structured Pino logging and correlation ID middleware

docs/
  adr/                     # Architecture Decision Records (ADR-001 through ADR-010)
  architecture/            # Architecture overview and topology diagrams
  implementation/          # Multi-phase implementation roadmap
```

---

## 4. Verification & Validation Commands

The following commands are available and verified for this root baseline:

```bash
# Verify formatting of root configuration files and documentation
cmd /c pnpm run format:check

# Auto-format supported configuration files and documentation
cmd /c pnpm run format

# Verify root TypeScript solution configuration
cmd /c pnpm exec tsc --showConfig
cmd /c pnpm exec tsc -b
```

---

## 5. Architectural References

- **Production Specification:** [`Grocery_Store_Production_Architecture_Final_Specification_v2.pdf`](./Grocery_Store_Production_Architecture_Final_Specification_v2.pdf)
- **Implementation Baseline:** [`Grocery_Store_Architecture_Implementation_Baseline_v3.pdf`](./Grocery_Store_Architecture_Implementation_Baseline_v3.pdf)
- **Frontend UI & Styling Rules:** [`STYLE.md`](./STYLE.md)
- **Architecture Overview:** [`docs/architecture/architecture-overview.md`](./docs/architecture/architecture-overview.md)
- **Implementation Roadmap:** [`docs/implementation/implementation-roadmap.md`](./docs/implementation/implementation-roadmap.md)
- **Architecture Decision Register:** [`docs/adr/decision-register.md`](./docs/adr/decision-register.md)
