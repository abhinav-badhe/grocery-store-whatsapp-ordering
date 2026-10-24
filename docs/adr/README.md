# Architecture Decision Records (ADRs)

## Overview

This directory contains the Architecture Decision Records (ADRs) for the **Grocery Store Management & WhatsApp Ordering System**. ADRs document significant architectural, domain, infrastructure, and technical design decisions, capturing their context, options considered, trade-offs, and compliance with the project's approved specifications.

## Authority and Precedence

The binding architectural authorities for this project are:
1. `Grocery_Store_Production_Architecture_Final_Specification_v2.pdf` (Primary Architecture & Functional Requirements Reference)
2. `Grocery_Store_Architecture_Implementation_Baseline_v3.pdf` (Implementation & Acceptance Baseline Reference)
3. `STYLE.md` (Mandatory Frontend UI & Styling Reference)

## Decision Lifecycles and Statuses

Every ADR maintains an explicit lifecycle status:

| Status | Definition |
| :--- | :--- |
| **`Proposed`** | Drafted by engineering/architecture; submitted for stakeholder review. Implementation MUST NOT proceed on unratified assumptions. |
| **`Accepted`** | Formally approved by designated decision owners (System Architect, Security Lead, Product/Business Owner, Finance Lead). Binding for implementation. |
| **`Rejected`** | Evaluated and determined unsuitable. Kept for historical context and rationale. |
| **`Superseded`** | Replaced by a newer decision record (must link to the superseding ADR). |

> **IMPORTANT:** In accordance with project governance rules, no decision is labeled `Accepted` without explicit sign-off from the documented decision owner.

## ADR Document Structure

Each ADR strictly adheres to the following standardized format:

1. **Title & Header:** ID, Title, Status, Date, Decision Owner, Relevance.
2. **Context:** Background, technical and operational situation.
3. **Mandated Requirements from Approved Specifications:** Direct citations from Spec v2.0 and Baseline v3.0.
4. **Options Considered:** Viable engineering options evaluated.
5. **Advantages and Disadvantages:** Comparative evaluation of each option.
6. **Proposed Decision:** Architectural recommendation and operational baseline.
7. **Consequences & Trade-offs:** Downstream effects (positive, negative, operational).
8. **Security & Tenant-Isolation Implications:** Protection against cross-tenant leaks, BOLA, injection, and privilege escalation.
9. **Reliability & Failure-Recovery Implications:** Handling crashes, idempotency, retries, and network partitions.
10. **Testing & Acceptance Criteria:** Verifiable test gates required before release.
11. **Dependencies:** Predecessor and successor ADR links.
12. **Explicit Owner Approval Required:** Named role or stakeholder who must ratify the decision.
13. **Unresolved Questions:** Specific policy, external, or environment items requiring stakeholder confirmation.

## Index of Initial Architecture Decision Records

| ADR | Title | Proposed Decision Summary | Decision Owner | Status |
| :--- | :--- | :--- | :--- | :--- |
| [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md) | Microservice Boundaries, Monorepo Layout & Vercel + Render Topology | Monorepo layout, Next.js on Vercel per `STYLE.md`, Render public Web Gateway (strips X-Internal-*), 5 Private Services, 3 Workers, dynamic $PORT binding | System Architect | `Proposed` |
| [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md) | PostgreSQL Ownership, Tenant Isolation & Render Postgres Strategy | Schema-per-service on Render Postgres; dedicated least-privilege roles; illustrative 49 baseline / 76 scaled connection demand; unconfirmed Render limits; transaction-local RLS rules; Day-1 (Phase 2) row-level `store_id` isolation | Database Architect & Security Lead | `Proposed` |
| [ADR-003](./ADR-003-authentication-and-identity-linking.md) | Authentication and Customer Identity Linking | Argon2id, HttpOnly secure cookies for web, verified bearer tokens for API, phone number normalization for WhatsApp | Security Lead | `Proposed` |
| [ADR-004](./ADR-004-payment-provider-and-reconciliation.md) | Payment Provider, Payment Links, and Reconciliation | Explicit state machine, signed webhooks with raw body check, UNKNOWN-outcome reconciliation worker | Product / Business Owner | `Proposed` |
| [ADR-005](./ADR-005-tax-invoicing-and-rounding.md) | Tax Rules, Invoicing, and Rounding Calculations | Integer minor unit math (paise/cents), immutable order/invoice snapshots, sequential numbering | Finance / Tax Lead | `Proposed` |
| [ADR-006](./ADR-006-whatsapp-integration-and-tenant-mapping.md) | WhatsApp Cloud API Integration and Tenant Mapping | Official Meta Cloud API, inbound deduplication, verified business-number-to-store mapping | Product / WhatsApp Ops | `Proposed` |
| [ADR-007](./ADR-007-order-review-and-inventory-reservation.md) | Order Review Workflow and Inventory Reservation | Strict shopkeeper review before reservation; atomic all-or-nothing stock locking; saga compensation | Lead Engineer | `Proposed` |
| [ADR-008](./ADR-008-hosting-secrets-backups-and-recovery.md) | Production Hosting (Vercel + Render), CloudAMQP, Storage & DR | Vercel for frontend; Render for Gateway, Private Services, and Workers; CloudAMQP proposed for RabbitMQ; S3-compatible storage abstraction; provisional RPO $\le 1$h, RTO $\le 2$h | DevOps / Ops Owner | `Proposed` |
| [ADR-009](./ADR-009-event-contracts-and-delivery-reliability.md) | Event Contracts, Transactional Outbox, CloudAMQP & Failure Recovery | CloudAMQP managed broker; Transactional Outbox with publisher confirms; Consumer Inbox deduplication; DLQ with bounded retries & replay CLI | Lead Backend Architect | `Proposed` |
| [ADR-010](./ADR-010-product-units-variants-and-pricing.md) | Product Variants, Canonical Units, and Pricing | Explicit SKUs, canonical units (kg, g, l, ml), validated fractional quantities, price change versioning | Catalog Domain Lead | `Proposed` |

See [decision-register.md](./decision-register.md) for the detailed status and dependency tracking matrix.
