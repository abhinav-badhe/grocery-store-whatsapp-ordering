# ADR-003: Authentication, Session Management, and Customer Identity Linking

## Status
`Proposed`

## Date
2026-10-24

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

- **Password Hashing:** Passwords must be hashed using **Argon2id** (or appropriately configured bcrypt) (Spec v2.0 §10, Baseline v3.0 §11).
- **Session Security:** Use `HttpOnly`, `Secure`, `SameSite=Strict` cookies for browser sessions, or short-lived signed access tokens paired with refresh tokens and revocation storage. Long-lived bearer tokens stored in browser `localStorage` are strictly prohibited (Spec v2.0 §10, Baseline v3.0 §11).
- **Rate Limiting:** Login attempts, password recovery, OTP submission, and authentication endpoints must enforce abuse rate limits (combining client IP and account identifiers) (Spec v2.0 §10, Baseline v3.0 §11).
- **Customer Phone Normalization:** Phone numbers must be normalized into a canonical E.164 format to link WhatsApp conversations reliably with web accounts and customer records (Baseline v3.0 §3, §10).

---

## 3. Options Considered

### A. Authentication & Session Mechanism
- **Option 1: HttpOnly Secure Cookies with Encrypted Sessions:**  
  Authentication state is stored in an encrypted, signed HTTP cookie (`Secure; HttpOnly; SameSite=Lax`). Session state is validated against a server-side Redis or PostgreSQL session table for instantaneous revocation.
- **Option 2: Short-lived Asymmetric JWTs (Access Token) + Rotating Refresh Token Cookie:**  
  15-minute RS256/EdDSA JWT access tokens verified locally by downstream microservices without querying a central session database. Refresh tokens are stored in an `HttpOnly` cookie and validated against an `identity` database revocation list.
- **Option 3: Pure Bearer JWTs Stored in Client LocalStorage:**  
  Client stores tokens in `window.localStorage` and attaches them via `Authorization: Bearer <token>`.

### B. Customer Identity & WhatsApp Account Linking
- **Option C1: Phone-Number-Centric Customer Identity (E.164 Canonical Key):**  
  Every customer is uniquely keyed by their normalized phone number (`+91XXXXXXXXXX`). WhatsApp orders and web orders share the same customer profile. Web login uses OTP verification sent to this phone number.
- **Option C2: Independent Email/Password for Web with Separate WhatsApp Mapping:**  
  Web accounts require email/password; WhatsApp customers are treated as anonymous or require manual account linking.

---

## 4. Advantages and Disadvantages

### Session Options
- **Option 1 (HttpOnly Secure Cookies):**
  - *Advantages:* Immune to XSS token theft; immediate server-side revocation on logout.
  - *Disadvantages:* Requires CSRF protection for mutating requests; microservices behind Gateway require the Gateway to translate the session cookie into a trusted internal identity header.
- **Option 2 (Short-lived JWT + Refresh Cookie):**
  - *Advantages:* Highly performant for microservices; stateless verification at each service boundary using public keys; low database lookup overhead; complies with modern frontend architectures.
  - *Disadvantages:* Revocation of an access token has up to a 15-minute propagation delay unless an active denylist is checked.
- **Option 3 (Bearer in LocalStorage):**
  - *Disadvantages:* Severe security vulnerability to XSS token exfiltration; violates specifications. Rejected.

### Customer Identity Options
- **Option C1 (E.164 Canonical Phone Key):**
  - *Advantages:* Natural alignment between WhatsApp ordering and web checkout; zero friction for customers receiving payment links on WhatsApp and completing payment in a mobile browser.
  - *Disadvantages:* Requires an SMS or WhatsApp OTP provider for web customer logins.

---

## 5. Proposed Decision

1. **Dual Session Architecture:**
   - **For Staff and Store Owners:** Web console utilizes Next.js App Router with short-lived JWT access tokens accompanied by an `HttpOnly`, `Secure`, `SameSite=Lax` refresh token cookie. CSRF protection is enforced via `SameSite` policies and custom anti-CSRF headers (`X-Requested-With` / double-submit token).
   - **Service-to-Service Propagation:** The API Gateway validates incoming session cookies, mints an internal short-lived HMAC-signed identity token (`X-Internal-Caller-Identity`) containing `userId`, `storeId`, and `roles`, and passes it downstream to internal microservices.
2. **Password & Credential Security:**
   - Standardize on **Argon2id** (`memoryCost: 65536, timeCost: 3, parallelism: 4`).
   - Implement IP-based and username-based rate limiting (5 failed attempts per 15 minutes triggers a temporary lock).
3. **Customer Identity Linking:**
   - Standardize on **E.164 normalized phone numbers** as the primary identity key for all customers across both Web and WhatsApp channels.
   - When an order originates on WhatsApp, the customer profile is resolved or created automatically using the sender's verified WhatsApp phone number.
   - When a customer clicks a payment link received via WhatsApp, the web payment interface authenticates access using a short-lived, cryptographically signed order access token (`order_token`), preventing unauthorized third parties from viewing order or customer details.

---

## 6. Consequences and Trade-offs

- **Positive:** Seamless customer transition from WhatsApp chat to mobile browser payment; zero XSS token exfiltration risk; stateless cryptographic validation across backend microservices.
- **Negative:** Internal microservices must share or access the public signing key to verify gateway-forwarded tokens.

---

## 7. Security and Tenant-Isolation Implications

- Store memberships are explicitly modeled (`StoreMembership` entity with `user_id`, `store_id`, `role`).
- A user may hold different roles in different stores (e.g. Owner of Store A, Staff in Store B). The active `store_id` is cryptographically locked into the session context.
- Cross-tenant token tampering will be rejected because the signature verification verifies the token integrity.

---

## 8. Reliability and Failure-Recovery Implications

- Refresh token rotation ensures that if a refresh token is reused, all tokens in that family are immediately revoked.
- If Redis is down, authentication can fall back to PostgreSQL database token validation.

---

## 9. Testing and Acceptance Criteria

- **Automated Password Security Test:** Confirm Argon2id parameter compliance; verify plain-text passwords cannot be authenticated.
- **BOLA Protection Test:** Customer A cannot retrieve Customer B's order profile using Customer A's session.
- **Rate Limit Test:** 6 rapid failed login attempts from a single IP must return `429 Too Many Requests`.

---

## 10. Dependencies

- **Predecessor:** [ADR-001](./ADR-001-microservice-boundaries-and-frontend.md), [ADR-002](./ADR-002-database-ownership-and-tenant-isolation.md).
- **Successor:** [ADR-006](./ADR-006-whatsapp-integration-and-tenant-mapping.md).

---

## 11. Explicit Owner Approval Required

- **Security Lead:** Approval of Argon2id hashing parameters, dual-session cookie strategy, and internal gateway token propagation.
- **Product Owner:** Confirmation of phone-number-based customer model.

---

## 12. Unresolved Questions

1. Which provider will be used for web customer login OTP delivery (WhatsApp Cloud API message vs. dedicated SMS gateway like Twilio/MSG91)?
2. What is the session inactivity timeout for store owners (e.g., 8 hours vs. 24 hours)?
