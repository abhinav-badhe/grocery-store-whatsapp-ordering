# ADR-011: Public Ingress, CORS, Cookie Transport, and Trusted Proxy Architecture

## Status
`Proposed`

## Date
2026-10-25

## Decision Owner
System Architect & Security Lead

---

## 1. Context

The platform deploys its frontend (`apps/web`) on the **Vercel Global Edge Network** and its API Gateway (`apps/api-gateway`) and private domain microservices on **Render** (as documented in `docs/architecture/architecture-overview.md`).

This distributed topology creates boundary interactions across distinct cloud providers, domains, and security zones:
1. Browser client-side fetch requests crossing the origin boundary from `https://store.<domain>` to `https://api.<domain>`.
2. Secure delivery of the session refresh-token cookie across subdomains without exposing session tokens to cross-site tracking blocks.
3. Preventing Cross-Site Request Forgery (CSRF) and Cross-Origin Resource Sharing (CORS) abuse on sensitive authentication endpoints.
4. Preserving authentic client IP addresses for brute-force rate-limiting across edge reverse proxies without falling victim to IP-spoofing attacks (CWE-348).

---

## 2. Mandated Requirements from Approved Specifications

- **Strict CORS Origin Allowlist:** CORS must be explicitly restricted to verified web origins; wildcard `*` with credentials is strictly prohibited (`Spec v2.0 §10`, `Baseline v3.0 §11`).
- **CSRF Defense on Cookies:** Formulate explicit CSRF protection whenever cookie-authenticated sessions are used (`Baseline v3.0 §11`).
- **Rate-Limiting on Ingress:** Protect authentication, login, and public endpoints using rate limiting combining client IP and account identifiers (`Spec v2.0 §10`, `Baseline v3.0 §11`).
- **Public vs. Private Network Isolation:** The API Gateway is the public ingress service; private domain services (`identity-service`, etc.) reside strictly within Render's internal private network (`Spec v2.0 §4`, `Baseline v3.0 §3`).

---

## 3. Deployment Alternatives Considered

### Option A: Direct Ingress on Shared Custom Registrable Domain (Recommended Candidate — Pending Owner Approval)
- Frontend deployed on Vercel: `https://store.<owned-domain>`.
- API Gateway deployed on Render Web Service: `https://api.<owned-domain>`.
- Browser communicates directly with Render Gateway.
- **Site Boundary:** Same-Site, Cross-Origin (shares eTLD+1 `<owned-domain>`).
- *Advantages:* Minimal network latency (direct single hop); offloads backend compute from Vercel; unconstrained by Vercel 4.5 MB function payload limits and 120s rewrite timeouts; preserves clean gateway boundary.
- *Trade-offs:* Requires ownership and DNS delegation of an apex domain (`<owned-domain>`); preview deployments on `*.vercel.app` require a dedicated staging domain to prevent cross-site cookie blocking.

### Option B: Same-Origin Vercel Server-Side Proxy / BFF
- Browser sends all API requests to `https://store.<owned-domain>/api/*`.
- Vercel forwards requests server-to-server over the public internet to Render Gateway.
- **Site Boundary:** Strictly Same-Origin to the browser.
- *Advantages:* Zero browser CORS required; preview deployments work out-of-the-box; supports the `__Host-` cookie prefix.
- *Trade-offs:* Double-hop network latency over public internet; subject to Vercel execution limits (4.5 MB body limit on route handlers, 120s rewrite timeout); requires maintaining Next.js Edge middleware to inject server secrets (`X-Vercel-Proxy-Secret`) to prevent direct public gateway bypass; increases Vercel compute billing.

---

## 4. Proposed Architectural Contracts (Option A Baseline)

### 4.1 Credentialed CORS Contract
Render API Gateway (`apps/api-gateway`) enforces:
1. **Dynamic Exact Origin Allowlisting:**
   - Validates incoming `Origin` against `CORS_ALLOWED_ORIGINS` (e.g. `['https://store.<owned-domain>']`).
   - If origin matches: Sets `Access-Control-Allow-Origin: <matching-origin>` and `Access-Control-Allow-Credentials: true`.
   - Wildcard `Access-Control-Allow-Origin: *` is strictly forbidden.
2. **Preflight Response Handling:**
   - Responds to `OPTIONS` with:
     - `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
     - `Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Correlation-ID, Idempotency-Key`
     - `Access-Control-Max-Age: 86400` (24 hours)

### 4.2 Refresh Cookie Transport and Scoping Rules
1. **Cookie Attributes:**
   - Name: `refresh_token`
   - Scope: Host-only cookie for `api.<owned-domain>` (the `Domain` attribute is deliberately omitted to prevent auxiliary subdomains from accessing the cookie).
   - Path: `Path=/api/v1/auth` (restricts automatic transmission exclusively to authentication endpoints: `/refresh` and `/logout`).
   - Flags: `HttpOnly; Secure; SameSite=Strict`.
2. **`__Host-` Prefix Limitation (RFC 6265bis §4.1.3.2):**
   - RFC 6265bis mandates that cookies with the `__Host-` prefix MUST have `Path=/`.
   - Because the security architecture restricts the refresh token to `Path=/api/v1/auth` to prevent ambient transmission on business API requests (`/catalog`, `/orders`), **the `__Host-` prefix cannot be used under Option A**.
3. **SameSite Behavior on Shared eTLD+1:**
   - Because `store.<domain>` and `api.<domain>` share the apex domain, requests between them are **Same-Site**.
   - Under RFC 6265bis, modern browsers transmit `SameSite=Strict` cookies on same-site cross-origin `fetch()` subresource calls made with `credentials: 'include'`.

### 4.3 Trusted-Proxy & Client-IP Resolution
1. **Public Gateway Ingress Sanitization:**
   - The public API Gateway terminates public TLS and acts as the strict trust boundary.
   - Gateway must remove, overwrite, or sanitize untrusted client-supplied forwarding headers (`X-Forwarded-For`, `CF-Connecting-IP`, `True-Client-IP`) before forwarding requests across Render's private network to downstream services.
   - Gateway establishes the canonical, verified client IP for downstream consumption.
2. **Downstream Service Trust Boundaries (identity-service):**
   - Private domain services (including `identity-service`) must **never** blindly read the leftmost IP address from `X-Forwarded-For` without a verified proxy-chain policy (vulnerable to client spoofing via forged incoming headers).
   - In `identity-service`, `trustProxy` must remain disabled (`false`) by default. It must not be enabled until the actual gateway-to-identity trust path, private network isolation, and header sanitization are verified in staging.
3. **Empirical Staging Verification & Diagnostic Boundary:**
   - Because Render does not publish internal proxy hop counts or officially document `True-Client-IP` across all tiers, header inspection must occur in a controlled staging environment before finalizing rate-limiting middleware.
   - Diagnostic inspection of forwarding headers must be conducted strictly via internal/staging logs or authenticated private probe tests. **Under no circumstances should diagnostic routes (e.g. debug endpoints) or raw forwarding headers be exposed publicly.**


### 4.4 Staging and Preview Deployment Strategy
- Because `*.vercel.app` and `*.onrender.com` reside on the Public Suffix List (PSL), browsers treat them as cross-site, blocking third-party cookies by default.
- Preview and staging environments under Option A must be verified using:
  1. A wildcard staging custom domain (e.g. `*.staging.<owned-domain>`).
  2. Automated headless end-to-end tests (where browser cookie jar policies are controlled).
  3. Local developer testing on loopback (`localhost`), where cross-port requests are exempt from PSL restrictions.

---

## 5. Decision Owner Approvals Required

- **System Architect & DevOps Lead:** Formal ratification of **Option A** as the production ingress topology.
- **Security Lead:** Approval of the CORS allowlist contract, cookie path restriction (`Path=/api/v1/auth`), and trusted proxy parsing model.

---

## 6. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-003](./ADR-003-authentication-and-identity-linking.md).
- **Successor:** [ADR-008](./ADR-008-hosting-secrets-backups-and-recovery.md).
