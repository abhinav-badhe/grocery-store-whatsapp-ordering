# Architecture Decision Register

## Status Tracking & Governance Matrix

**Project:** Grocery Store Management & WhatsApp Ordering System  
**Last Updated:** 2026-10-24 (Revised for Vercel + Render Deployment & Security Contracts)  
**Audit Baseline:** Complete (0 application files, clean Git baseline pending)  

---

## 1. Governance Rules

1. Every architectural and operational decision must be documented as an Architecture Decision Record (ADR) in `docs/adr/`.
2. No ADR may transition from `Proposed` to `Accepted` without explicit written approval from the designated **Decision Owner**.
3. No implementation phase may commence if any of its prerequisite ADRs remain unapproved or blocked.

---

## 2. Decision Register Matrix

| ADR ID | Decision Title | Status | Proposed Decision Summary | Decision Owner Required | Dependencies | Blocking Impact if Unresolved | Spec Reference |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **[ADR-001](./ADR-001-microservice-boundaries-and-frontend.md)** | Microservice Boundaries, Monorepo Layout & Vercel + Render Topology | `Proposed` | Next.js on Vercel; Render public Web Gateway (strips X-Internal-*); 5 Render Private Services; 3 Background Workers; Billing co-located in Order; dynamic $PORT binding. | **System Architect** | None | Blocks Phase 1 workspace initialization and repository structure. | Spec v2.0 §3–4, §18; Baseline v3.0 §3; `STYLE.md` |
| **[ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md)** | PostgreSQL Ownership, Tenant Isolation & Render Postgres Strategy | `Proposed` | Schema-per-service on Render Postgres; dedicated least-privilege roles; illustrative 49 baseline / 76 scaled connection demand; unconfirmed Render limits; transaction-local RLS rules; Day-1 (Phase 2) row-level store_id isolation. | **Database Architect & Security Lead** | ADR-001 | Blocks Phase 1 database containers and Phase 2 schema migrations. | Spec v2.0 §4, §7; Baseline v3.0 §4, §13 |
| **[ADR-003](./ADR-003-authentication-and-identity-linking.md)** | Authentication, Sessions & Customer Identity Linking | `Proposed` | Argon2id hashing; HttpOnly SameSite cookies for web; short-lived signed tokens for microservices; E.164 phone numbers for WhatsApp linking. | **Security Lead & Product Owner** | ADR-001, ADR-002 | Blocks Phase 2 Identity service and auth middleware. | Spec v2.0 §10; Baseline v3.0 §10–11 |
| **[ADR-004](./ADR-004-payment-provider-and-reconciliation.md)** | Payment Provider Integration & Reconciliation | `Proposed` | Provider-agnostic adapter; explicit state machine (`CREATED` $\rightarrow$ `PENDING` $\rightarrow$ `PAID`/`FAILED`/`UNKNOWN`); signed webhooks; reconciliation worker. | **Product Owner & Finance Lead** | ADR-001, ADR-002 | Blocks Phase 6 payment link generation and webhook processing. | Spec v2.0 §5.C, §9; Baseline v3.0 §8 |
| **[ADR-005](./ADR-005-tax-invoicing-and-rounding.md)** | Tax Calculation, Invoicing & Rounding Rules | `Proposed` | Integer minor units (paise); immutable invoice snapshots; sequential store invoice numbering; credit notes on cancellation. | **Finance Lead & Tax Accountant** | ADR-001, ADR-004 | Blocks Phase 6 billing module, tax calculations, and PDF invoice formatting. | Spec v2.0 §7; Baseline v3.0 §5, §8 |
| **[ADR-006](./ADR-006-whatsapp-integration-and-tenant-mapping.md)** | WhatsApp Cloud API Integration & Tenant Mapping | `Proposed` | Official Meta Cloud API; raw-body HMAC-SHA256 signature verification; inbound message ID deduplication; store phone mapping; 24h window template rules. | **Product Owner & WhatsApp Ops Lead** | ADR-001, ADR-003 | Blocks Phase 5 WhatsApp webhook handler and conversational ordering. | Spec v2.0 §5.B, §10; Baseline v3.0 §4, §10 |
| **[ADR-007](./ADR-007-order-review-and-inventory-reservation.md)** | Order Review Workflow & Inventory Reservation | `Proposed` | Strict shopkeeper review before reservation; atomic all-or-nothing stock reservation; deterministic ascending SKU locking; order saga coordinator. | **Application Architect & Product Owner** | ADR-001, ADR-002, ADR-010 | Blocks Phase 3 inventory concurrency and Phase 4 order state machine. | Spec v2.0 §2, §5.A, §7; Baseline v3.0 §5, §6.A, §7 |
| **[ADR-008](./ADR-008-hosting-secrets-backups-and-recovery.md)** | Production Hosting (Vercel + Render), CloudAMQP, Storage & DR | `Proposed` | Vercel for frontend; Render for Gateway, Private Services, and Workers; CloudAMQP proposed for RabbitMQ; S3-compatible storage abstraction; provisional RPO $\le 1$h, RTO $\le 2$h. | **DevOps Lead & System Operator** | ADR-001, ADR-002 | Blocks Phase 1 Docker Compose, health endpoints, and Phase 8 operations. | Spec v2.0 §1, §15, §17; Baseline v3.0 §14–16 |
| **[ADR-009](./ADR-009-event-contracts-and-delivery-reliability.md)** | Event Contracts, Transactional Outbox, CloudAMQP & Failure Recovery | `Proposed` | CloudAMQP managed broker; Transactional Outbox with publisher confirms; Consumer Inbox deduplication; DLQ with bounded retries & replay CLI; no exactly-once claims. | **Lead Backend Architect** | ADR-001, ADR-002, ADR-008 | Blocks Phase 1 message contracts and Phase 4 cross-service events. | Spec v2.0 §8, §9; Baseline v3.0 §12 |
| **[ADR-010](./ADR-010-product-units-variants-and-pricing.md)** | Product Variants, Canonical Units & Price Snapshots | `Proposed` | Product $\rightarrow$ Variant/SKU hierarchy; canonical units (`KG`, `G`, `L`, `ML`, `PIECE`); validated fractional quantities; immutable order price snapshots. | **Catalog Domain Lead & Product Owner** | ADR-001, ADR-002 | Blocks Phase 2 Catalog schema and Phase 3 Inventory balances. | Spec v2.0 §6; Baseline v3.0 §9 |

---

## 3. Immediate Action Items for Decision Owners

The following decisions require explicit stakeholder sign-off before Phase 1 implementation begins:

1. **ADR-001 Approval (System Architect):** Ratify Next.js App Router on Vercel and the Render service-worker topology.
2. **ADR-002 Approval (Database Architect):** Approve Schema-per-Service on Render Postgres 16 with PgBouncer pooling and connection budgeting.
3. **ADR-004 Provider Selection (Product Owner):** Specify target payment gateway (e.g. Razorpay vs. Stripe).
4. **ADR-005 Tax Policy (Finance Lead):** Specify tax jurisdiction, tax-inclusive vs. exclusive catalog pricing, and invoice numbering format.
5. **ADR-006 WhatsApp Setup (WhatsApp Ops Lead):** Confirm Meta Business Account setup and provisioned Phone Number IDs.
6. **ADR-008 Hosting & Storage Approval (DevOps Lead / Business Owner):** Approve Vercel Pro, Render compute tiers, CloudAMQP hosting budget, and Object Storage provider.
