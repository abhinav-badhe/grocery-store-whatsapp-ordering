# ADR-003: Authentication, Session Management, and Customer Identity Linking

## Status
`Proposed`

## Date
2026-10-25 (Revised per Step 2.4.5G Review)

## Decision Owner
Security Lead / Application Architect

---

## 1. Context

The platform supports multiple distinct user personas:
1. **Store Owners / Administrators:** Manage their store profile, staff permissions, catalog, prices, and view operational reports.
2. **Store Staff / Managers:** Review incoming customer orders, adjust quantities/substitutions, prepare orders, and update fulfillment statuses.
3. **Customers:** Browse store catalogs, place orders via web or WhatsApp, receive real-time status notifications, and view their purchase history.
4. **System Operators:** Platform operations, observability, and maintenance.

Authentication and identity management must balance robust security (defense against credential stuffing, brute force, session hijacking, BOLA) with frictionless customer ordering (particularly for WhatsApp customers transitioning to web payment links).

---

## 2. Mandated Requirements from Approved Specifications

- **Password Hashing:** Passwords must be hashed using **Argon2id** (or appropriately configured bcrypt) (`Spec v2.0 §10`, `Baseline v3.0 §11`).
- **Session Security:** Use `HttpOnly`, `Secure`, `SameSite=Strict` cookies for browser sessions, or short-lived signed access tokens paired with refresh tokens and revocation storage. Long-lived bearer tokens stored in browser `localStorage` or `sessionStorage` are strictly prohibited (`Spec v2.0 §10`, `Baseline v3.0 §11`).
- **Rate Limiting:** Login attempts, password recovery, OTP submission, and authentication endpoints must enforce abuse rate limits combining client IP and account identifiers (`Spec v2.0 §10`, `Baseline v3.0 §11`).
- **Customer Phone Normalization:** Phone numbers must be normalized into a canonical E.164 format to link WhatsApp conversations reliably with web accounts and customer records (`Baseline v3.0 §3, §10`).
- **CORS Allowlist Security:** Strict CORS origin allowlist matching explicit trusted web origins; wildcard `*` with credentials strictly prohibited (`Spec v2.0 §10`, `Baseline v3.0 §11`).

---

## 3. Options Considered

### A. Authentication & Session Mechanism
- **Option 1: HttpOnly Secure Cookies with Encrypted Sessions:**  
  Authentication state is stored in an encrypted, signed HTTP cookie (`Secure; HttpOnly; SameSite=Strict`). Session state is validated against a server-side session table on every request.
- **Option 2: Short-lived Asymmetric JWTs (Access Token) + Rotating Refresh Token Cookie (Recommended Candidate):**
  Short-lived asymmetric Ed25519 JWT access tokens held strictly in browser JavaScript memory, verified locally by API Gateway without querying a central session database. Single-use refresh tokens stored as SHA-256 hashes in PostgreSQL (`identity.refresh_tokens`) and delivered via a `Secure; HttpOnly; SameSite=Strict` cookie scoped to `Path=/api/v1/auth`.
- **Option 3: Pure Bearer JWTs Stored in Client LocalStorage:**  
  Client stores tokens in `window.localStorage` and attaches them via `Authorization: Bearer <token>`. Violates specifications; rejected.

### B. Customer Identity & WhatsApp Account Linking
- **Option C1: Phone-Number-Centric Customer Identity (E.164 Canonical Key):**  
  Every customer is uniquely keyed by their normalized phone number (`+91XXXXXXXXXX`). WhatsApp orders and web orders share the same customer profile. Web login uses OTP verification sent to this phone number.
- **Option C2: Independent Email/Password for Web with Separate WhatsApp Mapping:**  
  Web accounts require email/password; WhatsApp customers are treated as anonymous or require manual account linking.

---

## 4. Advantages and Disadvantages

### Session Options
- **Option 1 (HttpOnly Secure Cookies for All Requests):**
  - *Advantages:* Immune to XSS token theft; immediate server-side revocation on logout.
  - *Disadvantages:* Requires CSRF protection on every state-mutating request across all business services; microservices behind Gateway require the Gateway to translate the session cookie into a trusted internal identity header.
- **Option 2 (Short-lived Asymmetric JWT in Memory + Refresh Cookie):**
  - *Advantages:* Highly performant for microservices; stateless verification at API Gateway using public key; low database lookup overhead; in-memory storage eliminates persistent XSS theft; refresh token rotation limits reuse windows.
  - *Disadvantages:* Revocation of an access token has a propagation delay bounded by its lifetime (recommended 15 minutes) unless an active denylist is checked.
- **Option 3 (Bearer in LocalStorage):**
  - *Disadvantages:* Severe security vulnerability to XSS token exfiltration; violates specifications. Rejected.

---

## 5. Proposed Decision (Pending Decision-Owner Sign-Off)

1. **Dual Token Architecture:**
   - **Public Access Tokens (Client-to-Gateway):**
     - Signed asymmetrically using **Ed25519 (EdDSA)** with a `kid` header for key rotation.
     - The private key is held exclusively by `apps/identity-service`. The public verification key is distributed to `apps/api-gateway`.
     - Completely separated from symmetric internal service-token signing (`INTERNAL_TOKEN_SECRET`).
     - Delivered in JSON response bodies (`TokenResponseSchema`) and stored **strictly in browser memory** (React state / closure). Never persisted to `localStorage` or `sessionStorage`.
     - **Lifetime Recommendation (Pending Approval):** Exactly **15 minutes**.
   - **Refresh Tokens (Session Renewal):**
     - Raw 32-byte cryptographically secure random secret (`generateRefreshToken()`).
     - Persisted strictly as deterministic SHA-256 hex digests (`token_hash`) in `identity.refresh_tokens`. Raw tokens are never logged or stored.
     - Transported in a `Secure; HttpOnly; SameSite=Strict` cookie named `refresh_token`, scoped strictly to `Path=/api/v1/auth`.
     - **Lifetime Recommendations (Proposed — Pending Owner Approval):**
       - **Idle Window:** **7-day rolling window** (idle expiration resets upon each valid rotation).
       - **Absolute Maximum Family Lifetime:** **30-day absolute ceiling** from the initial login/issuance event.
     - **Absolute Refresh-Family Expiry Enforcement Requirements (Pre-requisite Gate):**
       - The absolute expiry is immutable for the lifetime of a refresh-token family.
       - Every rotated token in the family must remain bounded by the same family absolute expiry; rotation must never extend it.
       - Refresh must fail once the family absolute expiry is reached, even if the individual token's 7-day idle expiry has not elapsed.
       - If the proposed 30-day absolute family lifetime is approved, session issuance must not proceed until the database schema and repository persist and enforce this boundary, accompanied by dedicated PostgreSQL 16 automated tests.
       - The precise persistence representation (e.g. an immutable `family_expires_at` column on each token row versus a separate normalized family/session record) must be explicitly evaluated and selected prior to implementation. No specific schema alteration is assumed to be pre-approved.
2. **Rotation, Concurrency & Revocation Semantics:**
   - **Single-Use Rotation:** Every presentation of a valid refresh token atomically marks it `CONSUMED` and issues a new replacement token in the same `family_id` using `FOR UPDATE` row-level locking.
   - **Reuse Detection:** If an already `CONSUMED` token is presented, `identity-service` detects token theft and immediately revokes all tokens belonging to that `family_id` (`status = 'REVOKED', revoked_reason = 'REUSE_DETECTED'`).
   - **Client Concurrency Control:** `apps/web` must enforce a **client-side single-flight promise mutex** for `/api/v1/auth/refresh`. Multiple concurrent 401s from parallel UI fetches must share a single refresh promise, preventing race conditions without requiring insecure server grace windows.
   - **Access-Token Revocation Trade-off:** Stateless access tokens remain valid until their 15-minute expiration timestamp. Logout and revocation terminate refresh-token renewal immediately, ending the session upon access-token expiration without requiring a distributed Redis denylist.
3. **Route-Specific CSRF Contract:**
   - Cookie-authenticated endpoints (`POST /api/v1/auth/refresh`, `POST /api/v1/auth/logout`) enforce:
     1. **Exact Origin Validation:** Request `Origin` must match an entry in `CORS_ALLOWED_ORIGINS` (exact match, e.g. `https://store.<domain>`).
     2. **Referer Fallback:** If `Origin` is missing, `Referer` origin must match `CORS_ALLOWED_ORIGINS`. If both are absent, the request is rejected with `403 Forbidden`.
     3. **Mandatory Custom Header:** Must require `X-Requested-With: XMLHttpRequest` (or `X-CSRF-Token`). Standard HTML forms cannot set custom headers; cross-origin fetch calls setting custom headers trigger mandatory CORS preflights.
4. **Service-to-Service Propagation:**
   - The API Gateway verifies the public access token, extracts user and active store claims, mints an internal short-lived HMAC-signed identity token (`X-Internal-Token`, 60-second TTL), and forwards it across Render's internal private network.
5. **Password & Credential Security:**
   - Standardize on **Argon2id** (`memoryCost: 65536, timeCost: 3, parallelism: 4`).
   - Implement combined IP-based and identifier-based rate limiting (5 failed attempts per 15 minutes triggers a temporary lock).
   - **Trusted Client-IP Boundary & Gateway Sanitization:**
     - The public API Gateway terminates public TLS, strips or overwrites unverified client-supplied forwarding headers, and sets the canonical, verified client IP before proxying requests across Render's private network to `identity-service`.
     - `identity-service` must not blindly trust arbitrary incoming `X-Forwarded-For` headers or parse leftmost IP values without a verified proxy-chain configuration.
     - `trustProxy` in `identity-service` must remain disabled by default and must not be enabled until the actual gateway-to-identity forwarding trust path and header sanitization are verified in staging.
     - Render and Cloudflare edge forwarding header behavior remains unverified until empirically validated in a controlled staging environment. Under no circumstances should diagnostic routes or raw forwarding headers be exposed publicly.
6. **Customer Identity Linking:**
   - Standardize on **E.164 normalized phone numbers** as the primary identity key across WhatsApp and Web channels.
   - Payment links sent via WhatsApp authenticate access using cryptographically signed short-lived order tokens (`order_token`).

---

## 6. Consequences and Trade-offs

- **Positive:** Immune to persistent XSS token theft; eliminates cross-site tracking blocks on shared apex domain; stateless access token validation at Gateway; automatic theft containment via family revocation.
- **Negative:** Access tokens cannot be revoked instantly without an active denylist (15-minute exposure window); requires client-side refresh mutex in frontend; Option A requires custom domain DNS delegation.

---

## 7. Security and Tenant-Isolation Implications

- Store memberships are explicitly modeled (`StoreMembership` with `user_id`, `store_id`, `role`).
- The active `store_id` is locked into internal token claims (`tid`) along with verified store roles. Cross-tenant tampering is rejected at the gateway.

---

## 8. Reliability and Database Cleanup Boundary

- Database cleanup of expired refresh tokens is **deferred** until dedicated PostgreSQL 16 integration tests verify referential integrity under `ON DELETE SET NULL`, concurrent refresh races, and row-bounded micro-batch execution ($\le 1,000$ rows).

---

## 9. Testing and Acceptance Criteria

- **Automated Password Security Test:** Confirm Argon2id parameter compliance (`memoryCost: 65536, timeCost: 3, parallelism: 4`); verify plain-text passwords cannot be authenticated and that malformed or oversized hashes fail closed safely.
- **BOLA Protection Test:** Customer A cannot retrieve Customer B's order profile using Customer A's session or guessed resource identifiers.
- **Rate Limit Test:** 6 rapid failed login attempts from a single IP or identifier must return `429 Too Many Requests` with appropriate retry headers.
- **Token Signature & Verification Gate:** Verify asymmetric Ed25519 access token signature verification at API Gateway; verify expired, altered, or incorrectly signed tokens return `401 Unauthorized`.
- **Single-Use Rotation & Reuse Detection Gate:** Presenting an active refresh token rotates it and issues a new token within the same `family_id`; presenting an already `CONSUMED` token revokes all tokens within that family immediately (`REUSE_DETECTED`).
- **Absolute Family Expiry Enforcement Gate:** Once a token family reaches its 30-day absolute ceiling, rotation attempts must be rejected with `TOKEN_EXPIRED` even if the individual token has not reached its 7-day idle expiration.
- **Route-Specific CSRF Validation Gate:** Requests to `/api/v1/auth/refresh` and `/api/v1/auth/logout` that omit an approved `Origin` (or valid `Referer` fallback) or lack the required custom header (`X-Requested-With`) must be rejected with `403 Forbidden`.
- **Client-Side Single-Flight Mutex Gate:** Automated frontend test proving that multiple concurrent 401 responses trigger exactly one in-flight `/api/v1/auth/refresh` request, sharing the resulting promise across all callers.

---

## 10. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md).
- **Companion:** [ADR-011](./ADR-011-public-ingress-cors-and-cross-origin-cookie-transport.md).
- **Successor:** [ADR-006](./ADR-006-whatsapp-integration-and-tenant-mapping.md).

---

## 11. Explicit Owner Approval Required

- **Security Lead:** Approval of Ed25519 public access token signing, cookie scoping (`Path=/api/v1/auth`), proposed session lifetimes (15-minute access, 7-day idle refresh, 30-day absolute family cap), and client-IP trust model.
- **System Architect:** Ratification of Option A (direct ingress on shared apex domain) vs. Option B (Vercel proxy).
- **Product Owner:** Confirmation of phone-number-based customer model.

---

## 12. Unresolved Questions

1. Which provider will be used for web customer login OTP delivery (WhatsApp Cloud API message vs. dedicated SMS gateway)?
2. Confirmation of apex custom domain name and DNS registrar delegation.
