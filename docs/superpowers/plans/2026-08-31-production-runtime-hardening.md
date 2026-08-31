# Production Runtime Hardening Implementation Plan

> **Execution:** Follow `superpowers:executing-plans` inline. Subagents are intentionally not used because this repository's `AGENTS.md` permits them only when explicitly requested.

**Goal:** Make the public DocAI soft launch safe enough for an openly registered, low-cost deployment without changing the agreed product scope.

**Architecture:** Keep Cloudflare Worker → OCI Caddy/backend → conversion-service as the request path. Submit every selected PDF through the existing single-file proxy contract, cap the Redis waiting queue atomically at 100, make account lifecycle explicit, and fail readiness when public-facing legal/support configuration or Turnstile configuration is incomplete.

**Tech stack:** Next.js 16/React 19/Vitest, Express/Prisma/Jest, FastAPI/Redis/pytest, Docker Compose/Pester.

**Decision source:** `.scratch/production-readiness/spec.md`

## Global constraints

- Use strict red-green-refactor for every behavior change: write one focused regression, run it and observe the expected failure, implement the smallest change, then rerun the focused suite.
- Do not modify `README.md` or `frontend/components/landing/HeroDocument.tsx`; those paths contain unrelated user work.
- Do not change the existing public 10-file/50-MB-per-file UI limits.
- Do not re-enable password reset. Accounts may use unverified email addresses during the soft launch.
- Do not implement a registration-count ceiling; queue pressure is controlled at the job boundary.
- Return safe Vietnamese user-facing failures without leaking Redis, database, filesystem, or provider details.
- Keep production changes uncommitted until the final review and integration checkpoint.

---

## Task 1: Atomic 100-job queue admission

**Files:**
- Modify: `conversion-service/config.py`
- Modify: `conversion-service/job_store.py`
- Modify: `conversion-service/main.py`
- Modify: `conversion-service/user_errors.py`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `docker-compose.prod.yml`
- Modify: `conversion-service/tests/test_queue_durability.py`
- Modify: `conversion-service/tests/test_admission_lifecycle.py`
- Modify: `conversion-service/tests/test_quota_config.py`
- Modify: `ops/tests/ProdCompose.Tests.ps1`

**Interfaces:**
- `CONVERSION_MAX_QUEUE_DEPTH`: positive integer, default `100`.
- `JobStore.enqueue_bounded(payload: dict, max_depth: int) -> bool`: performs an atomic Redis `LLEN` + `LPUSH`; returns `False` when `queue:pending` already contains `max_depth` entries.
- HTTP overload response: status `503`, code `QUEUE_BUSY`, message `Hệ thống đang bận. Vui lòng thử lại sau.`

- [ ] Write config regressions proving missing input becomes `100` and non-positive/non-integer input fails closed.
- [ ] Run `conversion-service/.venv/Scripts/python.exe -m pytest conversion-service/tests/test_quota_config.py -q` and confirm RED.
- [ ] Add a small positive-integer parser in `config.py`, export `MAX_QUEUE_DEPTH`, and wire the env through both Compose files.
- [ ] Rerun the config test and confirm GREEN.
- [ ] Add queue-store regressions with a fake Redis script result:

```python
def test_enqueue_bounded_refuses_when_pending_queue_is_full(redis_store, redis_client):
    redis_client.eval.return_value = 0
    assert redis_store.enqueue_bounded({"jobId": "job-101"}, 100) is False
    redis_client.eval.assert_called_once()

def test_enqueue_bounded_accepts_and_serializes_once(redis_store, redis_client):
    redis_client.eval.return_value = 1
    assert redis_store.enqueue_bounded({"jobId": "job-100"}, 100) is True
```

- [ ] Run `conversion-service/.venv/Scripts/python.exe -m pytest conversion-service/tests/test_queue_durability.py -q` and confirm RED because `enqueue_bounded` does not exist.
- [ ] Implement the method with one Lua script; local/in-memory test mode uses the same max-depth rule under the store lock.
- [ ] Rerun the queue suite and confirm GREEN.
- [ ] Add an admission lifecycle regression that fills the pending queue, submits one PDF, expects `503/QUEUE_BUSY`, and proves charged quota, job state, staged upload, and provider secret are all rolled back.
- [ ] Run `conversion-service/.venv/Scripts/python.exe -m pytest conversion-service/tests/test_admission_lifecycle.py -q` and confirm RED.
- [ ] Route `_persist_and_dispatch` through bounded enqueue. Reuse the existing rollback/refund path when it returns `False`; translate only this expected condition to the safe overload response.
- [ ] Rerun the lifecycle suite, then `conversion-service/.venv/Scripts/python.exe -m pytest conversion-service/tests -q`.
- [ ] Run the production Compose Pester test and `git diff --check`.

---

## Task 2: Independent per-file submissions and five-second polling

**Files:**
- Modify: `frontend/lib/convert-api.ts`
- Modify: `frontend/components/convert/ConvertUploadDialog.tsx`
- Modify: `frontend/app/(app)/convert/page.tsx`
- Create: `frontend/test/convert-upload-dialog.test.tsx`
- Modify: `frontend/test/convert-polling.test.tsx`

**Interfaces:**
- `submitConversionsIndividually(files: File[]): Promise<IndividualSubmissionResult>` submits one `POST /api/proxy/convert` at a time and preserves each file's result independently.
- `IndividualSubmissionResult` contains `jobs` and `failures`, keyed by the original array index so duplicate filenames remain distinct.
- Poll interval is exactly `5_000` ms.

- [ ] Write a pure API regression with three files where the second request returns `503`; assert three single-file fetches occur in order, jobs 1 and 3 are retained, and failure 2 carries its file/index.
- [ ] Run `npm --prefix frontend test -- --run test/convert-upload-dialog.test.tsx` and confirm RED.
- [ ] Implement sequential single-file submission in `convert-api.ts`. Sequential dispatch is deliberate: it avoids ten simultaneous 50-MB requests on the small VM while keeping failures independent.
- [ ] Update the dialog to consume the result, retain only failed files, report per-file errors, preserve the scanned-document settings deep link, close when all succeed, and still call `onSubmitted` for partial successes.
- [ ] Rerun the upload-dialog regression and confirm GREEN.
- [ ] Change the fake-timer polling test to assert no second poll at `4_999` ms and a poll at `5_000` ms.
- [ ] Run the focused polling test and confirm RED against the current 1.5-second value.
- [ ] Set `POLL_INTERVAL_MS = 5_000`, rerun both focused tests, then run `npm --prefix frontend test -- --run --maxWorkers=4` and `npm --prefix frontend run typecheck`.

---

## Task 3: Backend account lifecycle and safe operator CLI

**Files:**
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/routes/auth.contract.test.ts`
- Create: `backend/src/scripts/manage_users.ts`
- Create: `backend/src/scripts/manage_users.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- `DELETE /api/auth/me` requires a valid bearer session and body `{ "password": string }`; it rechecks the current password and deletes the user in one transaction. Prisma cascades `PasswordResetToken` and `UserLLMConfig`.
- CLI env contract:
  - `USER_ADMIN_ACTION=list|disable|enable|delete`
  - `USER_ADMIN_USERNAME=<canonical username>` for mutating actions
  - `USER_ADMIN_CONFIRM=<same canonical username>` additionally required for delete
- List output includes only `id`, `username`, `email`, `role`, `isDisabled`, `createdAt`; it never includes password hashes or encrypted provider fields.

- [ ] Add auth-route tests for successful deletion, wrong password (`401`), absent user (`404`), missing session (`401`), and database failure (`500`); successful deletion must call a transaction and never echo the password.
- [ ] Run `npm --prefix backend test -- --run src/routes/auth.contract.test.ts` and confirm the success case is `404`/RED.
- [ ] Add a `DeleteAccountSchema`, authenticated route, password verification, and transactional deletion. Return `204` with no response body.
- [ ] Rerun the auth contract and confirm GREEN.
- [ ] Write dependency-injected CLI tests covering list redaction, exact canonical username matching, disable/enable session-version increment, delete confirmation mismatch refusal, and successful cascade delete.
- [ ] Run `npm --prefix backend test -- --run src/scripts/manage_users.test.ts` and confirm RED because the entry point is missing.
- [ ] Implement `manageUsers(input, deps)` following the existing `reset_operator_password.ts` boundary. CLI failures print one generic stderr line and exit nonzero; implementation functions return precise errors for tests.
- [ ] Add `deploy:users` to `backend/package.json`, rerun the focused tests, then `npm --prefix backend run build`.

---

## Task 4: Self-service deletion in the authenticated UI

**Files:**
- Create: `frontend/app/api/session/account/route.ts`
- Create: `frontend/components/settings/AccountSettingsDialog.tsx`
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/components/auth/AuthProvider.tsx`
- Modify: `frontend/test/session-routes.test.ts`
- Modify: `frontend/test/settings-dialogs.test.tsx`

**Interfaces:**
- Worker route forwards `DELETE` to `/api/auth/me` with the server-owned bearer cookie and `{password}` body, then expires the session cookie only after backend success.
- Account dialog requires password plus exact confirmation text `XÓA TÀI KHOẢN`; destructive submit is disabled until both are present.

- [ ] Add route regressions proving missing session returns `401`, backend `401` is forwarded without clearing the cookie, and backend `204` clears the cookie with the same production cookie attributes as logout.
- [ ] Run `npm --prefix frontend test -- --run test/session-routes.test.ts` and confirm RED.
- [ ] Implement the session route using the established server backend/session helpers; rerun and confirm GREEN.
- [ ] Add dialog tests for closed initial state, explicit confirmation gate, inline wrong-password error, and successful deletion calling auth refresh/logout navigation.
- [ ] Run `npm --prefix frontend test -- --run test/settings-dialogs.test.tsx` and confirm RED.
- [ ] Implement the account dialog and add a sidebar entry below provider settings. Keep focus trapping and 44px targets consistent with existing dialogs.
- [ ] Rerun focused tests, frontend typecheck, and lint.

---

## Task 5: Public policy pages and production-readiness configuration

**Files:**
- Create: `frontend/lib/server/public-site-config.ts`
- Create: `frontend/lib/server/public-site-config.test.ts`
- Create: `frontend/components/legal/PolicyLayout.tsx`
- Create: `frontend/app/privacy/page.tsx`
- Create: `frontend/app/terms/page.tsx`
- Create: `frontend/app/data-handling/page.tsx`
- Create: `frontend/components/legal/PolicyLinks.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/(auth)/layout.tsx`
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/app/api/ready/route.ts`
- Modify: `frontend/test/health-routes.test.ts`
- Modify: `.env.example`
- Modify: `docker-compose.prod.yml`
- Modify: `wrangler.jsonc`

**Interfaces:**
- Required public values: `PUBLIC_OPERATOR_NAME=DocAI`, `PUBLIC_OPERATOR_JURISDICTION=Vietnam`, `PUBLIC_SUPPORT_EMAIL=support@<real-domain>`, `PUBLIC_POLICY_EFFECTIVE_DATE=YYYY-MM-DD`.
- `readPublicSiteConfig(env)` validates all four, rejects `<domain>`, `.test`, `.invalid`, malformed emails/dates, and returns a typed immutable object.
- When `DISABLE_PUBLIC_REGISTER=false`, `/api/ready` also requires valid public-site configuration plus both Turnstile keys.

- [ ] Write parser regressions for the agreed values and each missing/placeholder/malformed value; run focused test and confirm RED.
- [ ] Implement the pure parser and confirm GREEN.
- [ ] Add readiness regressions: private registration may omit public values; open registration fails readiness if support/policy or Turnstile config is missing; complete config passes.
- [ ] Run the health-route suite and confirm RED, wire the checks, then confirm GREEN.
- [ ] Create concise Vietnamese policy pages covering account data, encrypted BYOK keys, temporary source/output files, cookies/session, Turnstile, deletion, 30-day encrypted backup expiry, service limitations, and support contact. Terms must state the converter is provided without guaranteed legal fidelity and users must review outputs.
- [ ] Add footer/sidebar policy links without touching `HeroDocument.tsx`.
- [ ] Add env/Worker bindings with no fabricated final domain or secret.
- [ ] Run landing, auth-page, root-layout, health, typecheck, and lint suites.

---

## Task 6: Runtime checkpoint

- [ ] Run backend tests and build:

```powershell
npm --prefix backend test -- --runInBand
npm --prefix backend run build
```

- [ ] Run frontend tests, typecheck, lint, and worker build:

```powershell
npm --prefix frontend test -- --run --maxWorkers=4
npm --prefix frontend run typecheck
npm --prefix frontend run lint
npm --prefix frontend run build:worker
```

- [ ] Run conversion-service tests:

```powershell
conversion-service/.venv/Scripts/python.exe -m pytest conversion-service/tests -q
```

- [ ] Run repository contracts with process-only safe volume overrides:

```powershell
$env:POSTGRES_VOLUME='standalone_contract_postgres'
$env:REDIS_VOLUME='standalone_contract_redis'
./ops/verify-all.ps1 -ContractsOnly
```

- [ ] Run `git diff --check` and inspect only the files in this plan. Do not stage unrelated user paths.
- [ ] Continue with `2026-08-31-production-operations-and-cutover.md`.
