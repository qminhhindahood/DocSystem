# Open Registration with Cloudflare Turnstile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable public production signup only after a server-validated Cloudflare Turnstile challenge and a Redis-backed per-IP signup limit.

**Architecture:** The React signup form explicitly renders Turnstile and passes its token through the same-origin Next.js session route. The private Express backend is authoritative: it applies a signup-specific Redis limiter, verifies the token with Cloudflare Siteverify, checks action and hostname, and only then creates the user. Terraform supplies the public site key as frontend configuration and the secret key from GCP Secret Manager to the backend.

**Tech Stack:** Next.js 16, React 19, Express 4, Zod 3, Redis 4, Jest/Supertest, Vitest/Testing Library, Terraform, Google Cloud Run, Secret Manager, GitHub Actions, Cloudflare Turnstile Siteverify.

## Global Constraints

- Public registration is enabled only with `DISABLE_PUBLIC_REGISTER=false` and complete Turnstile configuration.
- Turnstile server validation is mandatory, fail-closed, action-bound to `signup`, hostname-bound, limited to 2,048 token characters, and performed before database access.
- Signup is limited to five attempts per derived client IP per 15 minutes and fails closed when Redis is unavailable.
- The Turnstile secret is backend-only; the site key is public frontend configuration.
- Email verification and password recovery remain disabled, and the UI must warn users accordingly.
- Existing user-data ownership boundaries, session-cookie behavior, bootstrap jobs, and operator login remain unchanged.
- Unrelated working-tree files must not be staged or modified.

---

### Task 1: Backend Turnstile configuration and verifier

**Files:**
- Create: `backend/src/services/turnstile_service.ts`
- Create: `backend/src/services/turnstile_service.test.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/src/utils/validateEnv.test.ts`

**Interfaces:**
- Produces: `verifyTurnstile(input: { token: string; remoteIp?: string }): Promise<TurnstileResult>` where `TurnstileResult` is `{ ok: true } | { ok: false; reason: 'rejected' | 'unavailable' }`.
- Consumes environment: `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAMES`, and `DISABLE_PUBLIC_REGISTER`.

- [ ] **Step 1: Write failing environment and service tests**

Add assertions that enabled production registration rejects missing Turnstile configuration, and service tests covering valid, rejected, wrong-action, wrong-hostname, timeout, and malformed Siteverify responses using an injected `fetch` function.

```ts
expect(() => validateEnv()).toThrow(/TURNSTILE_SECRET_KEY/);
expect(await verifyTurnstile({ token: 'valid', remoteIp: '203.0.113.1' }, fetchStub))
  .toEqual({ ok: true });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/utils/validateEnv.test.ts src/services/turnstile_service.test.ts --runInBand`

Expected: FAIL because the verifier and production configuration checks do not exist.

- [ ] **Step 3: Implement the minimal verifier and validation**

Use a 5-second `AbortSignal.timeout`, POST JSON to `https://challenges.cloudflare.com/turnstile/v0/siteverify`, include `secret`, `response`, and optional `remoteip`, and require `success`, action `signup`, and an exact configured hostname. Map HTTP/network/parse failures to `unavailable`; map challenge mismatches to `rejected`. Never log the token or secret.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- src/utils/validateEnv.test.ts src/services/turnstile_service.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/services/turnstile_service.ts backend/src/services/turnstile_service.test.ts backend/src/utils/validateEnv.ts backend/src/utils/validateEnv.test.ts
git commit -m "feat: validate Turnstile registration challenges"
```

### Task 2: Backend registration enforcement and rate limiting

**Files:**
- Modify: `backend/src/middleware/ratelimit.ts`
- Modify: `backend/src/middleware/security_regressions.test.ts`
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/auth.contract.test.ts`

**Interfaces:**
- Consumes: `verifyTurnstile({ token, remoteIp })` from Task 1.
- Produces: `signupLimiter`, keyed as `signup:<trusted address>`, with five requests per 15 minutes.
- Request contract: `turnstileToken: string` and optional server-only `X-DocAI-Client-IP` header.

- [ ] **Step 1: Write failing route and limiter tests**

Cover missing/oversized token, rejected/unavailable challenge, valid challenge, database-call ordering, and export/configuration of `signupLimiter`. Assert no user lookup or creation occurs until verification succeeds.

```ts
expect(response.status).toBe(403);
expect(response.body.code).toBe('TURNSTILE_REJECTED');
expect(mockFindFirst).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- src/routes/auth.contract.test.ts src/middleware/security_regressions.test.ts --runInBand`

Expected: FAIL because registration neither rate-limits nor verifies Turnstile.

- [ ] **Step 3: Implement minimal enforcement**

Add `turnstileToken` to `RegisterSchema`, run `signupLimiter` before the handler, derive the verification address only from the internal header or Express request address, call `verifyTurnstile`, and return stable codes:

```ts
{ code: 'TURNSTILE_REQUIRED', error: 'Vui lòng hoàn tất bước xác minh.' }
{ code: 'TURNSTILE_REJECTED', error: 'Xác minh không hợp lệ hoặc đã hết hạn. Vui lòng thử lại.' }
{ code: 'TURNSTILE_UNAVAILABLE', error: 'Không thể xác minh lúc này. Vui lòng thử lại sau.' }
```

Keep 429 behavior from the limiter and the existing 409 account conflict.

- [ ] **Step 4: Run focused and backend suites**

Run: `npm test -- src/routes/auth.contract.test.ts src/middleware/security_regressions.test.ts --runInBand`

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add backend/src/middleware/ratelimit.ts backend/src/middleware/security_regressions.test.ts backend/src/routes/auth.ts backend/src/routes/auth.contract.test.ts
git commit -m "feat: protect public registration"
```

### Task 3: Next.js session boundary and trusted address forwarding

**Files:**
- Create: `frontend/lib/server/client-ip.ts`
- Create: `frontend/test/client-ip.test.ts`
- Modify: `frontend/app/api/session/signup/route.ts`
- Modify: `frontend/test/session-routes.test.ts`

**Interfaces:**
- Produces: `deriveClientIp(request: NextRequest): string | undefined` using the Cloud Run forwarding chain and configured proxy-hop count.
- Forwards: `X-DocAI-Client-IP` only when the server derives a valid IPv4 or IPv6 address.

- [ ] **Step 1: Write failing session and address tests**

Assert that `turnstileToken` is required and forwarded, `passwordConfirmation` is omitted, the derived client address is forwarded, and a spoofed browser `X-DocAI-Client-IP` value is ignored.

```ts
expect(mockForwardToBackend).toHaveBeenCalledWith('POST', '/api/auth/register', expect.objectContaining({
  body: JSON.stringify({ username: 'alice', email: 'alice@example.com', password: 'password123', turnstileToken: 'challenge' }),
}));
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run frontend/test/session-routes.test.ts frontend/test/client-ip.test.ts`

Expected: FAIL because the token and trusted address are not forwarded.

- [ ] **Step 3: Implement the boundary**

Validate the token as a non-empty string up to 2,048 characters, derive the client address from the trusted forwarding chain, add the internal header server-side, and keep same-origin enforcement and secure-cookie handling unchanged.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- --run frontend/test/session-routes.test.ts frontend/test/client-ip.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/lib/server/client-ip.ts frontend/test/client-ip.test.ts frontend/app/api/session/signup/route.ts frontend/test/session-routes.test.ts
git commit -m "feat: forward protected signup challenges"
```

### Task 4: Accessible Turnstile signup interface

**Files:**
- Create: `frontend/components/auth/TurnstileWidget.tsx`
- Create: `frontend/types/turnstile.d.ts`
- Modify: `frontend/components/auth/AuthForm.tsx`
- Modify: `frontend/app/(auth)/signup/page.tsx`
- Modify: `frontend/test/auth-pages.test.tsx`

**Interfaces:**
- `TurnstileWidget` props: `{ siteKey: string; action: 'signup'; resetKey: number; onToken(token: string | null): void; onError(message: string): void }`.
- `AuthForm` signup props include `turnstileSiteKey` and pass `turnstileToken` to the session route.

- [ ] **Step 1: Write failing UI tests**

Test the fail-closed missing-key state, disabled submit before challenge success, token submission, recovery warning, challenge reset after server rejection, retained username/email, and cleared passwords.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --run frontend/test/auth-pages.test.tsx`

Expected: FAIL because no widget or warning exists.

- [ ] **Step 3: Implement explicit rendering and form state**

Load `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, render a managed flexible widget with action `signup`, expose accessible loading/error status, and remove the widget on cleanup. Pass the site key from the server-rendered signup page. Disable submit until a token exists. After any rejected submission increment `resetKey`, clear both passwords, and preserve username/email.

- [ ] **Step 4: Run focused tests, typecheck, and lint**

Run: `npm test -- --run frontend/test/auth-pages.test.tsx`

Run: `npm run typecheck`

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add frontend/components/auth/TurnstileWidget.tsx frontend/types/turnstile.d.ts frontend/components/auth/AuthForm.tsx "frontend/app/(auth)/signup/page.tsx" frontend/test/auth-pages.test.tsx
git commit -m "feat: add Turnstile signup experience"
```

### Task 5: Terraform and production configuration

**Files:**
- Modify: `infra/terraform/secrets.tf`
- Modify: `infra/terraform/iam.tf`
- Modify: `infra/terraform/variables.tf`
- Modify: `infra/terraform/cloud_run.tf`
- Modify: `infra/terraform/prod.tfvars.example`
- Modify: `deploy/docker-compose.prod.yml`
- Modify: `ops/test-prod-compose.ps1`
- Modify: `ops/tests/TerraformPlan.Tests.ps1`

**Interfaces:**
- Terraform variable: `turnstile_site_key` (non-sensitive public string).
- Secret version map key: `turnstile-secret-key`.
- Backend env: `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAMES`, `DISABLE_PUBLIC_REGISTER=false`.
- Frontend env: `TURNSTILE_SITE_KEY`.

- [ ] **Step 1: Write failing infrastructure contracts**

Require the secret resource/binding, explicit version, backend secret reference, exact hostname configuration derived from `public_frontend_origin`, frontend site key, and enabled production registration with Turnstile present.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `pwsh -NoProfile -File ops/test-prod-compose.ps1`

Run: `pwsh -NoProfile -Command "Invoke-Pester ops/tests/TerraformPlan.Tests.ps1 -Output Detailed"`

Expected: FAIL on missing Turnstile wiring.

- [ ] **Step 3: Implement Terraform and Compose wiring**

Add `turnstile-secret-key` to external secrets and backend IAM access. Inject the secret only into the backend, derive the expected hostname without scheme/path, pass the public site key to the frontend, and require deliberate test-key configuration in Compose contracts.

- [ ] **Step 4: Format and verify infrastructure**

Run: `terraform fmt -recursive infra/terraform`

Run: `terraform -chdir=infra/terraform init -backend=false`

Run: `terraform -chdir=infra/terraform validate`

Run the two contract commands from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add infra/terraform deploy/docker-compose.prod.yml ops/test-prod-compose.ps1 ops/tests/TerraformPlan.Tests.ps1
git commit -m "feat: configure protected production signup"
```

### Task 6: Deployment workflow, smoke checks, and operations documentation

**Files:**
- Modify: `.github/workflows/deploy-production.yml`
- Modify: `ops/gcp/smoke-production.ps1`
- Modify: `ops/tests/GcpRunbooks.Tests.ps1`
- Modify: `docs/operations/gcp-owner-action-guide.md`
- Modify: `backend/.env.example`
- Modify: `frontend/.env.example`

**Interfaces:**
- Candidate deployment preserves Terraform-managed Turnstile variables and secret references.
- Smoke contract proves missing challenge rejection while existing smoke-user login and processing remain healthy.

- [ ] **Step 1: Write failing workflow/runbook tests**

Require a public-registration negative smoke assertion and documentation for Turnstile key creation, hostname restriction, secret rotation, disabling signup, and the lack of recovery and per-user cost quotas.

- [ ] **Step 2: Run tests and verify RED**

Run: `pwsh -NoProfile -Command "Invoke-Pester ops/tests/GcpRunbooks.Tests.ps1 -Output Detailed"`

Expected: FAIL on absent protected-registration smoke and documentation.

- [ ] **Step 3: Implement deployment and documentation updates**

Add a smoke request to `/api/session/signup` without a token and require a stable rejection without creating a user. Ensure candidate deploy commands do not clear existing Turnstile environment or secret configuration. Document operator setup and emergency rollback with `DISABLE_PUBLIC_REGISTER=true`.

- [ ] **Step 4: Run operations and workflow contracts**

Run: `pwsh -NoProfile -Command "Invoke-Pester ops/tests/GcpRunbooks.Tests.ps1,ops/tests/RepositoryHygiene.Tests.ps1 -Output Detailed"`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add .github/workflows/deploy-production.yml ops/gcp/smoke-production.ps1 ops/tests/GcpRunbooks.Tests.ps1 docs/operations/gcp-owner-action-guide.md backend/.env.example frontend/.env.example
git commit -m "docs: operate protected public registration"
```

### Task 7: Full verification and production rollout

**Files:**
- Modify locally only: `infra/terraform/prod.tfvars` with the real public site key, secret version, and release image tag.

**Interfaces:**
- Requires operator-supplied Turnstile site key and secret key.
- Produces a promoted Cloud Run release with verified signup.

- [ ] **Step 1: Run the full repository verifier**

Run: `pwsh -NoProfile -File ops/verify-all.ps1`

Expected: all verification steps pass.

- [ ] **Step 2: Push implementation commits and create the GCP secret**

Add `docai-turnstile-secret-key` through Terraform, then add the real value with `gcloud secrets versions add ... --data-file=-` using an interactive/non-echoing input path. Pin the resulting numeric version in ignored `prod.tfvars`. Never put the secret on a command line or in logs.

- [ ] **Step 3: Apply Terraform and pin jobs to the release SHA**

Run a saved Terraform plan, inspect it for only intended registration/release changes, apply it, and verify Cloud Run backend/frontend environment and secret references without printing the secret.

- [ ] **Step 4: Push the final release SHA and monitor GitHub deployment**

Confirm image scans, migration, no-traffic candidates, negative signup smoke, existing-account processing smoke, and traffic promotion all pass.

- [ ] **Step 5: Verify real production signup**

Open `/signup`, complete the live Turnstile challenge, create one disposable account, verify its session and empty isolated document/template state, and remove or disable it through the audited operator path. Recheck `/api/live`, `/api/ready`, all Cloud Run service Ready conditions, Redis/database readiness, and alerts.

- [ ] **Step 6: Record final evidence**

Record the release SHA, successful workflow URL, promoted revisions, health results, account-isolation result, and any non-blocking warnings. Do not claim completion without this evidence.
