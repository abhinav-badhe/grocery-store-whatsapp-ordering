# ADR-008: Production Hosting on Vercel + Render, Messaging/Storage Proposals, and Operational Requirements

## Status
`Proposed`

## Date
2026-10-24 (Revised for Platform Capability Requirements, Qualified Operational Guarantees, and Object Storage)

## Decision Owner
DevOps Lead / System Operator / Business Owner

---

## 1. Context

The project's approved architecture mandates production-grade reliability, security, observability, and recoverability while exercising strict scope discipline (avoiding Kubernetes, Kafka, or service meshes prior to measurable scale).

The approved production deployment architecture is:
- **Frontend:** **Vercel** (Next.js App Router).
- **Backend Application Services & Workers:** **Render** (Web Services, Private Services, Background Workers).
- **Relational Database:** Managed **PostgreSQL 16** (Render Postgres, plan unconfirmed).
- **Asynchronous Messaging:** **RabbitMQ** (CloudAMQP proposed, pending budget approval).
- **Object Storage:** **S3-Compatible Cloud Storage** (Cloudflare R2 / AWS S3 proposed, pending budget approval).

---

## 2. Mandated Requirements from Approved Specifications

- **Frontend Standard:** Vercel frontend must adhere strictly to `STYLE.md` (Next.js App Router, Tailwind CSS v4, shadcn/ui) (Spec v2.0 §3, `STYLE.md`).
- **Single Public Entry Point:** All browser and webhook traffic enters through the public API Gateway; internal domain services are not directly accessible from the public internet (Spec v2.0 §4, Baseline v3.0 §3).
- **Durable Storage Only:** Ephemeral container filesystems must never be treated as the source of truth for business data, orders, invoices, or stock (Baseline v3.0 §1, §15).
- **Secret Redaction & Environment Injection:** Secrets must never be committed to source control or exposed in frontend client bundles (Spec v2.0 §10, Baseline v3.0 §11).
- **Graceful Shutdown & Health Probes:** Services must handle `SIGTERM`, drain connections within platform limits, and provide `/health/live` and `/health/ready` endpoints (Spec v2.0 §11, §15, Baseline v3.0 §14, §16).
- **Disaster Recovery Targets:** Define and test RPO and RTO. Targets must be marked provisional until validated by tested restore drills (Spec v2.0 §7, §15, Baseline v3.0 §16).

---

## 3. Platform Capabilities & Operational Realities (Not Unconditional Guarantees)

Platform features provided by Render and Vercel represent **capabilities with strict application configuration and runtime requirements, not unconditional guarantees**:

| Platform Feature | Operational Reality & Application Requirements | Failure Mode if Misconfigured |
| :--- | :--- | :--- |
| **Public TLS Termination** | Render edge terminates TLS on 443 and forwards plain HTTP to the container. Application must listen on `process.env.PORT`. | Hardcoding port numbers causes container deployment failure or unhealthy status. |
| **Private Networking (`*.render.internal`)** | Resolves only inside Render. Provides network boundary, but **does not prove caller identity**. Applications must authenticate requests via signed internal tokens. | Blindly trusting private network traffic allows unauthorized internal lateral movement. |
| **Ephemeral Container Storage** | Disks are completely wiped on deploy, crash, or restart. Applications must stream uploads and PDFs directly to Cloud Object Storage. | Storing invoices or uploads on local disk results in catastrophic permanent data loss on container restart. |
| **Graceful Shutdown (`SIGTERM`)** | Render issues `SIGTERM` and grants **at most 30 seconds** before sending `SIGKILL`. Applications must stop accepting new work, finish in-flight transactions, and drain pools within 25 seconds. | If a service hangs on an un-timed-out query or remote API call, Render hard-kills (`SIGKILL`) the container at 30s, risking interrupted work. |
| **Cold Starts & Instance Spin-Down** | Free instances spin down after 15 minutes of inactivity. Production must use paid Starter/Standard instances. | Free tier spin-down causes 50+ second cold starts, dropping incoming Meta WhatsApp webhooks. |

---

## 4. Object Storage Abstraction & Secure Media Handling

Because product images (catalog) and itemized tax invoice documents (billing) require durable file storage, the system will implement an **S3-Compatible Object Storage Abstraction** (`StorageServicePort`). No specific cloud provider (AWS S3 vs. Cloudflare R2 vs. Google Cloud Storage) is assumed as pre-approved.

```typescript
export interface StorageServicePort {
  generatePresignedUploadUrl(params: PresignedUploadParams): Promise<PresignedUrlResult>;
  generatePresignedDownloadUrl(params: PresignedDownloadParams): Promise<string>;
  deleteFile(fileKey: string): Promise<void>;
}
```

### Media Upload & Download Security Controls
1. **Catalog Product Images:**
   - Client requests pre-signed upload URL from `catalog-service`.
   - File Validation: Content-Type allowlist (`image/jpeg`, `image/png`, `image/webp`), magic-byte inspection on upload callback, maximum size 5MB.
   - Storage Key: `stores/{store_id}/products/{product_id}/{image_uuid}.webp`.
   - Public Delivery: Served via CDN cache headers with public read access.
2. **Billing Invoice PDFs & Receipts:**
   - Background worker generates PDF invoice in memory/stream and writes to storage key: `stores/{store_id}/invoices/{fiscal_year}/{invoice_id}.pdf`.
   - **Private Access Invariant:** Invoices are stored as **private objects**. Download URLs are time-limited pre-signed URLs (15-minute expiration) generated only after verifying that the requesting user owns or has authorized access to that invoice. Public bucket listing is disabled.

---

## 5. CloudAMQP Messaging Evaluation (Proposed)

Render does not offer a native managed RabbitMQ service. CloudAMQP is proposed as the dedicated messaging provider:

| Evaluation Criterion | Specification Requirement | CloudAMQP Capability / Constraints |
| :--- | :--- | :--- |
| **Protocol & TLS** | AMQP 0-9-1 with TLS | `amqps://` encrypted connection on port 5671. |
| **Durable Queues & Exchanges** | Survives broker restarts | Backed by managed persistent disk storage. |
| **Connection Limits** | Multi-service connection ceiling | Free tier ("Little Lemur") limited to 20 connections; paid plans (Lemur / Tiger) support hundreds of pooled connections. |
| **Monitoring & Alarms** | Queue backlog, dead-letter count | Built-in web dashboard, RabbitMQ management API, CPU/RAM/queue alarms. |
| **Backups & HA** | Broker state recovery | Automated cluster configuration backups; Multi-AZ cluster on production plans. |

**Proposed Status:** CloudAMQP is recommended as the messaging provider, but requires explicit Business Owner approval of the production plan subscription cost before Phase 8 launch.

---

## 6. Disaster Recovery Targets (Provisional)

The following targets represent the system's design objectives, explicitly designated as **PROVISIONAL** until proven through physical restore drills:

| Metric | Provisional Target | Operational Mechanism & Constraints |
| :--- | :--- | :--- |
| **Recovery Point Objective (RPO)** | $\le 1$ Hour | Render Postgres automated daily snapshots paired with WAL archiving for point-in-time recovery. Transactional Outbox ensures message loss is bounded to uncommitted DB transactions. |
| **Recovery Time Objective (RTO)** | $\le 2$ Hours | Provisioning replacement Render Postgres instance and replaying WAL logs; redeploying stateless containers via Render Blueprints. |

> **PROVISIONALITY NOTE:** In compliance with governance rules, these RPO and RTO targets are not verified facts. They will be marked verified only after a physical restore drill is executed in an isolated staging environment during Phase 8.

---

## 7. Consequences and Trade-offs

- **Positive:** Leverages best-of-breed platforms (Vercel edge for frontend, Render for long-running private services and workers); completely eliminates local disk corruption risks.
- **Negative:** External dependencies on CloudAMQP and Object Storage require separate credential management and budget approvals.

---

## 8. Testing and Acceptance Criteria

- **Render Graceful Shutdown Verification:** Send `SIGTERM` to `order-service` while an order is processing; verify process finishes the database commit and exits with code 0 within 25 seconds (Render `SIGKILL` timeout is 30s).
- **CORS & Origin Security Gate:** Verify request to API Gateway from unauthorized origin is blocked with CORS error.
- **Object Storage Access Gate:** Attempt to access an invoice PDF without an authenticated signed URL; verify `403 Access Denied`.
- **Restore Drill Gate (Phase 8):** Execute automated restore drill on Render Postgres backup; verify data integrity assertions pass.

---

## 9. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md).
- **Successor:** All implementation phases.

---

## 10. Explicit Owner Approval Required

- **DevOps Lead / System Operator:** Approval of Render service types, CloudAMQP adoption, and Render Blueprint deployment structure.
- **Business Owner:** Approval of hosting budgets across Vercel (Pro), Render (Paid compute/Postgres), CloudAMQP, and Cloud Object Storage.

---

## 11. Unresolved Questions

1. Which CloudAMQP plan (Free Little Lemur for staging vs Paid Lemur/Tiger for production) is approved?
2. Which cloud object storage provider (Cloudflare R2 vs AWS S3) is approved for immutable PDF receipts and product images?
3. What is the approved custom domain hierarchy (e.g., `app.grocerystore.com` for Vercel, `api.grocerystore.com` for Render Gateway)?
