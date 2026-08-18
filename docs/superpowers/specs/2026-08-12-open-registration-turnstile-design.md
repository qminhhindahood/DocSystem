# Open Registration with Cloudflare Turnstile Design

**Date:** 2026-08-12
**Status:** Approved for implementation planning
**Scope:** Public account registration for the GCP production deployment

## Objective

Allow anyone who reaches the production signup page to create a DocAI account while protecting the registration endpoint from automated abuse. Accounts become usable immediately after signup. Email verification and email-based password recovery remain unavailable for this release.

## Decisions

- Production registration is open.
- Every production signup requires a Cloudflare Turnstile challenge.
- Turnstile is verified by the backend before any user lookup, password hashing, or database write.
- Signup also has a Redis-backed IP rate limit of five attempts per 15 minutes.
- New accounts do not require email verification.
- The signup form warns that password recovery is unavailable and that users must retain their password.
- Existing per-user ownership boundaries for documents, templates, profiles, feedback, and LLM configuration remain unchanged.
- The existing bootstrap and password-reset jobs remain available for operator recovery.

## Architecture

### Browser

The `/signup` page renders Cloudflare's managed Turnstile widget using a public site key. Explicit rendering is used because the form is a client-rendered React component. The widget uses the action name `signup` and returns a short-lived token to the form.

The submit button remains disabled until the challenge produces a token. The browser sends the following fields to the same-origin Next.js session endpoint:

- `username`
- `email`
- `password`
- `passwordConfirmation`
- `turnstileToken`

The browser never receives or handles the Turnstile secret key.

### Next.js session boundary

`POST /api/session/signup` keeps the existing same-origin mutation check and local validation. It removes `passwordConfirmation`, normalizes the email address, and forwards `username`, `email`, `password`, and `turnstileToken` to the private backend.

The session boundary derives the browser address from Cloud Run's trusted forwarding headers. It does not accept a client-provided DocAI-specific address header. It forwards the derived value in `X-DocAI-Client-IP` over the IAM-authenticated frontend-to-backend connection.

The backend registration service is private. Only explicitly authorized Cloud Run identities can reach it, so public browsers cannot supply the internal address header directly. The production smoke identity may also invoke the backend for release verification; that identity is controlled by the project and is not exposed to users.

On successful registration, the session boundary stores the returned JWT in the existing secure, HTTP-only session cookie. It never returns the raw JWT to the browser.

### Backend registration boundary

`POST /api/auth/register` performs work in this order:

1. Confirm public registration is explicitly enabled.
2. Validate the request schema, including a non-empty Turnstile token no longer than 2,048 characters.
3. Apply the Redis-backed signup limit using the trusted internal client address. If the header is absent, use the request address as a safe fallback.
4. Validate the Turnstile token with Cloudflare's Siteverify API.
5. Require `success=true`, `action=signup`, and a hostname from the configured allowlist.
6. Check username and email uniqueness.
7. Hash the password and create the user.
8. Return the existing role-free user session response.

Turnstile validation uses a bounded timeout and fails closed. A missing, malformed, expired, reused, mismatched, or unverifiable token never creates an account. Cloudflare tokens are single-use and expire after five minutes, so the UI obtains a fresh token after every rejected submission.

The backend sends Cloudflare the secret key, challenge response, and derived remote address. It may send an idempotency key if retry behavior is added, but the initial implementation performs one bounded validation attempt to avoid ambiguity around single-use tokens.

## Configuration and secrets

### Frontend

- `TURNSTILE_SITE_KEY`: public site key read by the server-rendered signup page and embedded in the widget.

The value is intentionally public but is supplied as runtime deployment configuration so development, test, and production can use different widgets and rotate it without a special image build.

### Backend

- `TURNSTILE_SECRET_KEY`: secret key sourced from GCP Secret Manager.
- `TURNSTILE_EXPECTED_HOSTNAMES`: comma-separated exact hostname allowlist.
- `DISABLE_PUBLIC_REGISTER=false`: explicit opt-in required in production.

The production hostname allowlist initially contains the canonical Cloud Run frontend hostname used by the application. When a custom domain is added, it must be added to both the Turnstile widget's hostname configuration and the backend allowlist before traffic moves to it.

Terraform creates and binds a `docai-turnstile-secret-key` secret. The secret value is added out of band and is never committed, printed, included in Terraform state as plaintext input, or exposed to the frontend container.

Environment validation rejects a production configuration that enables public registration without all three Turnstile settings. It also rejects a secret that is obviously empty and an empty hostname allowlist. Local development may use Cloudflare's documented test keys.

## Abuse controls

Turnstile is the bot-verification layer. A dedicated Redis limiter is the request-budget layer:

- Window: 15 minutes
- Maximum: 5 attempts per derived client IP
- Enforcement: before the Siteverify request
- Redis failure behavior: fail closed with HTTP 503
- Limit response: HTTP 429 with retry information

The existing broad API limiter remains in place. The signup-specific key namespace prevents signup attempts from consuming unrelated endpoint budgets.

Rate limiting cannot prevent all distributed abuse. Logs record the outcome category, request ID, and a one-way hash of the client address, but never the password, Turnstile token, secret key, email address, or raw address. A future release may add account quotas or administrative suspension if real-world usage requires them.

## User experience

The Vietnamese signup form includes:

- The existing username, email, password, and confirmation fields.
- A managed Turnstile widget using the current visual theme.
- A clear warning that email is collected as an account identifier but is not verified.
- A clear warning that password recovery is unavailable and the password must be stored safely.
- Accessible status text while the challenge loads or refreshes.
- A retry message when verification expires, is rejected, or cannot be reached.

The form resets the widget after any unsuccessful signup submission because a token cannot be reused. It preserves non-secret username and email values, clears both password fields, and returns focus to the appropriate error summary or challenge.

If the Turnstile script cannot load, signup remains unavailable and the page explains that verification could not be loaded. There is no CAPTCHA bypass.

## Error contract

The backend returns stable public outcomes without exposing Cloudflare diagnostics:

- `400 TURNSTILE_REQUIRED`: no valid challenge token was supplied.
- `403 TURNSTILE_REJECTED`: Cloudflare rejected the challenge, action, or hostname.
- `409 ACCOUNT_EXISTS`: the username or email is already registered.
- `429 SIGNUP_RATE_LIMITED`: the address exceeded the signup budget.
- `503 TURNSTILE_UNAVAILABLE`: validation or rate-limit enforcement could not be completed safely.

Detailed Cloudflare error codes may be logged as bounded categories for operators, but are not returned to the browser. Existing registration validation errors remain HTTP 400.

## Data isolation and cost boundary

Registration does not grant an administrative role. The JWT continues to contain only the user identity, username, token use, and session version. Existing backend queries scope private data by user ID.

Each user supplies their own LLM provider configuration and API key. Shared project services such as Cloud Run, Cloud SQL, Redis, Docling, embeddings, renderer, storage, and the configured Jina integration can still incur owner costs. Turnstile and signup rate limiting reduce automated account creation but do not constitute per-account spending quotas. This limitation is disclosed in operations documentation.

## Testing strategy

Implementation follows test-driven development.

### Backend tests

- Production registration remains fail-closed unless explicitly enabled.
- Enabling registration without complete Turnstile configuration fails environment validation.
- Missing, oversized, rejected, expired/reused, wrong-action, and wrong-hostname tokens are rejected before database access.
- Valid Turnstile verification allows the existing registration flow.
- The signup limiter uses the trusted forwarded address and returns 429 after five attempts.
- Redis or Siteverify failure returns 503 without creating a user.
- Logs and responses do not contain secrets, tokens, passwords, or raw personal data.

Siteverify is represented by an injected validator interface in route tests. Service-level tests exercise its real request/response parsing with a controlled HTTP boundary rather than calling Cloudflare from the unit suite.

### Frontend tests

- Signup cannot submit before Turnstile succeeds.
- The token and normalized account fields are forwarded correctly.
- Password confirmation is never forwarded.
- The client-derived address ignores spoofed DocAI-specific headers and is forwarded only by the server boundary.
- Failed submissions reset the challenge and clear passwords without clearing username or email.
- Recovery and email-verification warnings are visible and accessible.
- Missing site-key or script-load failure produces a fail-closed state.

### Infrastructure and release tests

- Terraform validates the secret binding and the explicit production registration flag.
- Production Compose contracts require a deliberate Turnstile configuration when registration is enabled.
- Secret scanning proves no real Turnstile value is committed.
- Production smoke uses Cloudflare's supported test mechanism only in an isolated test configuration; the live production smoke instead verifies that signup rejects a missing/invalid token and that the existing smoke account can still log in.
- A manual post-deploy check creates one fresh account through the real widget, verifies login and data isolation, and deletes or disables the test account afterward through an audited operator procedure.

## Rollout

1. Implement and verify backend, frontend, infrastructure, and operations changes locally.
2. Create the Turnstile managed widget with only the production frontend hostname allowed.
3. Add the site key to the frontend deployment configuration.
4. Add the secret key as a new GCP Secret Manager version without displaying it in logs.
5. Deploy no-traffic backend and frontend candidates.
6. Run health, authentication, missing-token rejection, and existing-account smoke checks.
7. Manually complete the real Turnstile flow and create a disposable production account.
8. Confirm the disposable account can log in but cannot access the operator's documents, templates, settings, or feedback.
9. Promote both candidates together.
10. Monitor signup outcomes, 429 responses, Siteverify failures, 5xx responses, readiness, database connections, Redis, and processing costs.

## Rollback

Set `DISABLE_PUBLIC_REGISTER=true` and redeploy the backend to stop new registrations immediately. The signup UI should also switch to a disabled state in the paired frontend release, but backend enforcement is authoritative. Existing accounts and sessions remain valid. Rollback never requires deleting users or rotating the Turnstile keys unless key exposure is suspected.

## Acceptance criteria

- A visitor can complete Turnstile and create a new account from the production signup page.
- Missing, forged, expired, reused, wrong-action, and wrong-hostname tokens cannot create accounts.
- More than five signup attempts from one address in 15 minutes are rejected.
- Turnstile or Redis failure cannot bypass verification.
- The secret key is present only in backend Secret Manager wiring.
- New users receive a secure session and cannot access another user's private data.
- The UI clearly states that email is not verified and password recovery is unavailable.
- Existing operator login, document processing, Docling, embeddings, renderer, database, and Redis checks remain healthy.
- The full repository verifier and production deployment workflow pass before promotion.
