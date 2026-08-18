# SMTP-Free GCP Personal Pilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the single-operator GCP pilot without SMTP by disabling email recovery and adding a human-invoked, secret-backed Cloud Run password-reset job.

**Architecture:** The backend and frontend receive an explicit `PASSWORD_RESET_MODE=disabled` runtime setting and reject/hide email recovery before any account or token work. A dedicated backend command resets only the bootstrapped operator in one transaction; a least-privilege Cloud Run job and interactive PowerShell helper supply a temporary password through Secret Manager and clean it up after execution.

**Tech Stack:** TypeScript 7, Express, Prisma/PostgreSQL, Jest, Next.js 16, React 19, Vitest, PowerShell 7/Pester 5, Terraform 1.15.8, Google Cloud Run v2, Cloud SQL, Secret Manager, IAM, GitHub Actions.

## Global Constraints

- The pilot supports exactly one human application account and keeps public registration disabled.
- Production requires explicit `PASSWORD_RESET_MODE`; accepted values are exactly `disabled` and `email`.
- Disabled mode performs no email validation, user lookup, reset-token mutation, password hashing, or SMTP call on the public recovery endpoints.
- The reset job targets only `docai-bootstrap-username`; no request or command-line argument may select another user.
- Password material must never enter Git, GitHub, Terraform state, command arguments, command history, files, or logs.
- The reset transaction changes `passwordHash`, increments `sessionVersion`, and invalidates every unused reset token atomically.
- Only the configured human operator can plan/apply or execute `docai-reset-password`; GitHub cannot read Terraform state, mutate IAM, act as the reset identity, or run the job.
- The backend image remains the single artifact for the API, migration, bootstrap, and reset commands.
- Secret references use exact numeric versions. Production workloads never use `latest`.
- Production stays gated by repository variable `PRODUCTION_ENABLED=false` throughout implementation and verification.
- Every behavior change follows red-green TDD; every task ends with focused verification and a commit.

## File and Responsibility Map

- `backend/src/utils/password_reset_mode.ts`: parse the two-value mode and expose the stable disabled response.
- `backend/src/utils/password_reset_mode.test.ts`: mode default, explicit-production, and invalid-value tests.
- `backend/src/utils/validateEnv.ts`: require SMTP configuration only in email mode and expose reusable username/password validation.
- `backend/src/utils/validateEnv.test.ts`: production environment contracts for both modes.
- `backend/src/routes/auth.ts`: reject disabled recovery before validation or service calls.
- `backend/src/routes/auth.contract.test.ts`: HTTP status, stable code, and no-side-effect route tests.
- `backend/src/scripts/reset_operator_password.ts`: validate and transactionally reset the one bootstrap operator.
- `backend/src/scripts/reset_operator_password.test.ts`: identity, transaction, session invalidation, token invalidation, and redaction tests.
- `backend/package.json`: expose `deploy:reset-password` for the shared image.
- `frontend/lib/server/password-reset-mode.ts`: server-only mode parsing and unavailable response factory.
- `frontend/components/auth/PasswordResetUnavailable.tsx`: one localized unavailable state shared by both recovery pages.
- `frontend/components/auth/AuthForm.tsx`: hide the forgot-password link when disabled.
- `frontend/app/(auth)/login/page.tsx`: pass the server-derived capability to `AuthForm`.
- `frontend/app/(auth)/forgot-password/page.tsx`: render the disabled state instead of a form.
- `frontend/app/(auth)/reset-password/page.tsx`: render the disabled state instead of a form.
- `frontend/app/api/session/forgot-password/route.ts`: return the stable disabled response before parsing an email.
- `frontend/app/api/session/reset-password/route.ts`: return the stable disabled response before parsing a token or password.
- `frontend/test/auth-pages.test.tsx`: disabled login and recovery-page behavior.
- `frontend/test/session-routes.test.ts`: disabled BFF response and no-forwarding behavior.
- `infra/terraform/variables.tf`: operator identity and SMTP-free secret-version contract.
- `infra/terraform/secrets.tf`: retain empty SMTP containers and add the temporary reset secret container.
- `infra/terraform/iam.tf`: reset service account, scoped operator access, and non-executing deployer role.
- `infra/terraform/cloud_run.tf`: disabled runtime environment and private reset job.
- `infra/terraform/monitoring.tf`: include reset-job failures in the job alert.
- `infra/terraform/prod.tfvars.example`: remove SMTP inputs and document the operator email.
- `ops/tests/TerraformPlan.Tests.ps1`: rendered-plan invariants for SMTP removal, reset-job isolation, and IAM.
- `.github/workflows/deploy-production.yml`: publish images, wait for the human Terraform apply, verify release-pinned jobs, and retain no Terraform or reset execution path.
- `ops/tests/GitHubWorkflow.Tests.ps1`: workflow contract preventing automated reset execution.
- `ops/lib/AdminPasswordReset.psm1`: secure prompt conversion, in-memory Secret Manager API call, job binding, execution, and cleanup orchestration.
- `ops/gcp/reset-production-password.ps1`: thin interactive owner command.
- `ops/tests/AdminPasswordReset.Tests.ps1`: cleanup-on-success and cleanup-on-failure Pester tests.
- `ops/gcp/smoke-production.ps1`: assert that recovery endpoints are disabled.
- `docs/operations/gcp-owner-action-guide.md`: reduce remaining required secrets to the three bootstrap values.
- `docs/operations/gcp-production-runbook.md`: document the break-glass reset and SMTP-free launch gate.

---

### Task 1: Explicit Password-Reset Mode and Backend HTTP Gate

**Files:**
- Create: `backend/src/utils/password_reset_mode.ts`
- Create: `backend/src/utils/password_reset_mode.test.ts`
- Modify: `backend/src/utils/validateEnv.ts:1-140`
- Modify: `backend/src/utils/validateEnv.test.ts:1-125`
- Modify: `backend/src/routes/auth.ts:1-120`
- Modify: `backend/src/routes/auth.contract.test.ts:1-175`

**Interfaces:**
- Consumes: `NodeJS.ProcessEnv`, existing Express auth router, and existing `validateEnv()` startup path.
- Produces: `PasswordResetMode`, `getPasswordResetMode(env)`, `isEmailPasswordResetEnabled(env)`, `PASSWORD_RESET_DISABLED_CODE`, and `PASSWORD_RESET_DISABLED_MESSAGE` for backend and tests.

- [ ] **Step 1: Write failing parser and environment tests**

Create `password_reset_mode.test.ts` with these exact cases:

```ts
import { getPasswordResetMode, isEmailPasswordResetEnabled } from './password_reset_mode';

describe('password reset mode', () => {
  it('requires an explicit mode in production', () => {
    expect(() => getPasswordResetMode({ NODE_ENV: 'production' })).toThrow(/PASSWORD_RESET_MODE/);
  });

  it.each(['disabled', 'email'] as const)('accepts %s', (mode) => {
    expect(getPasswordResetMode({ NODE_ENV: 'production', PASSWORD_RESET_MODE: mode })).toBe(mode);
  });

  it('rejects every other value', () => {
    expect(() => getPasswordResetMode({ NODE_ENV: 'production', PASSWORD_RESET_MODE: 'smtp' })).toThrow(/disabled.*email/);
  });

  it('keeps email recovery enabled by default outside production', () => {
    expect(isEmailPasswordResetEnabled({ NODE_ENV: 'test' })).toBe(true);
  });
});
```

Extend `validateEnv.test.ts` so disabled production mode has no SMTP variables, while email mode retains the current strict checks:

```ts
it('accepts explicit disabled password recovery without SMTP', () => {
  process.env.NODE_ENV = 'production';
  Object.assign(process.env, REQUIRED_VARS());
  process.env.CORS_ORIGIN = 'https://app.example.com';
  process.env.PASSWORD_RESET_MODE = 'disabled';
  for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_USER', 'SMTP_PASS', 'PASSWORD_RESET_BASE_URL']) {
    delete process.env[key];
  }
  const { validateEnv } = require('./validateEnv');
  expect(() => validateEnv()).not.toThrow();
});

it('requires complete mail configuration in email mode', () => {
  process.env.NODE_ENV = 'production';
  Object.assign(process.env, REQUIRED_VARS());
  process.env.CORS_ORIGIN = 'https://app.example.com';
  process.env.PASSWORD_RESET_MODE = 'email';
  delete process.env.SMTP_HOST;
  const { validateEnv } = require('./validateEnv');
  expect(() => validateEnv()).toThrow(/SMTP_HOST/);
});
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```powershell
Set-Location backend
npm test -- --runInBand src/utils/password_reset_mode.test.ts src/utils/validateEnv.test.ts
```

Expected: FAIL because `password_reset_mode.ts` and explicit mode handling do not exist.

- [ ] **Step 3: Implement the mode parser and conditional environment contract**

Create the utility with this complete public contract:

```ts
export type PasswordResetMode = 'disabled' | 'email';

export const PASSWORD_RESET_DISABLED_CODE = 'PASSWORD_RESET_DISABLED';
export const PASSWORD_RESET_DISABLED_MESSAGE =
  'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.';

export function getPasswordResetMode(env: NodeJS.ProcessEnv = process.env): PasswordResetMode {
  const raw = env.PASSWORD_RESET_MODE?.trim();
  if (!raw && env.NODE_ENV !== 'production') return 'email';
  if (raw === 'disabled' || raw === 'email') return raw;
  throw new Error('PASSWORD_RESET_MODE must be explicitly set to disabled or email in production');
}

export function isEmailPasswordResetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return getPasswordResetMode(env) === 'email';
}
```

In `validateEnv()`, call `getPasswordResetMode()` once. Move the paired SMTP credential check and all mail/reset URL validation inside `if (resetMode === 'email')`. Do not add mail variables to `REQUIRED`. Update the test helper `REQUIRED_VARS()` to include `PASSWORD_RESET_MODE: 'email'` so every pre-existing production validation case continues to exercise the current email-mode contract unless a test explicitly overrides it.

- [ ] **Step 4: Write failing backend route tests for disabled mode**

Add to `auth.contract.test.ts`:

```ts
it.each([
  ['/api/auth/forgot-password', { email: 'not-an-email' }],
  ['/api/auth/reset-password', { token: 'bad', password: 'short' }],
])('blocks %s before input or service work when recovery is disabled', async (path, body) => {
  process.env.PASSWORD_RESET_MODE = 'disabled';
  const response = await request(app).post(path).send(body);

  expect(response.status).toBe(503);
  expect(response.body).toEqual({
    code: 'PASSWORD_RESET_DISABLED',
    error: 'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.',
  });
  expect(mockRequestPasswordReset).not.toHaveBeenCalled();
  expect(mockResetPassword).not.toHaveBeenCalled();
});
```

Set `process.env.PASSWORD_RESET_MODE = 'email'` in `beforeEach` so existing email-mode route contracts remain active.

- [ ] **Step 5: Run the route test and confirm it fails through validation or the service path**

Run:

```powershell
npm test -- --runInBand src/routes/auth.contract.test.ts
```

Expected: FAIL because disabled mode is not checked before the validators.

- [ ] **Step 6: Add the route availability guard before validators and limiters**

Add a local Express handler in `auth.ts`:

```ts
function requireEmailPasswordReset(
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  if (isEmailPasswordResetEnabled()) return next();
  return res.status(503).json({
    code: PASSWORD_RESET_DISABLED_CODE,
    error: PASSWORD_RESET_DISABLED_MESSAGE,
  });
}
```

Register it first on both routes:

```ts
router.post('/forgot-password', requireEmailPasswordReset, forgotPasswordLimiter, validate(ForgotPasswordSchema), async (req, res) => {
  await requestPasswordReset(req.body.email).catch(() => undefined);
  res.status(202).json({ success: true, message: 'Nếu email tồn tại, hướng dẫn đặt lại mật khẩu đã được gửi.' });
});

router.post('/reset-password', requireEmailPasswordReset, resetPasswordLimiter, validate(ResetPasswordSchema), async (req, res) => {
  try {
    await resetPassword(req.body.token, req.body.password);
    res.json({ success: true });
  } catch {
    res.status(400).json({ error: 'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' });
  }
});
```

- [ ] **Step 7: Verify focused and full backend tests, then commit**

Run:

```powershell
npm test -- --runInBand src/utils/password_reset_mode.test.ts src/utils/validateEnv.test.ts src/routes/auth.contract.test.ts
npm test -- --runInBand
npm run build
```

Expected: focused tests PASS, full backend suite PASS, TypeScript build exits 0.

Commit:

```powershell
git add backend/src/utils/password_reset_mode.ts backend/src/utils/password_reset_mode.test.ts backend/src/utils/validateEnv.ts backend/src/utils/validateEnv.test.ts backend/src/routes/auth.ts backend/src/routes/auth.contract.test.ts
git commit -m "feat: gate email password recovery by mode"
```

### Task 2: Transactional Single-Operator Password Reset Command

**Files:**
- Create: `backend/src/scripts/reset_operator_password.ts`
- Create: `backend/src/scripts/reset_operator_password.test.ts`
- Modify: `backend/src/utils/validateEnv.ts:60-90`
- Modify: `backend/src/utils/validateEnv.test.ts`
- Modify: `backend/package.json:5-24`

**Interfaces:**
- Consumes: `hashPassword(password): Promise<string>`, Prisma `User`, Prisma `PasswordResetToken`, `RESET_USERNAME`, and `RESET_PASSWORD`.
- Produces: `normalizeUsername(raw): string`, `validateAccountPassword(raw): string`, `resetOperatorPassword(input, deps): Promise<{ userId: string }>`, and package script `deploy:reset-password`.

- [ ] **Step 1: Extract failing shared credential-validation tests**

Add tests proving trimming applies only to usernames and never to passwords:

```ts
it('shares canonical username and password validation without changing password bytes', () => {
  const { normalizeUsername, validateAccountPassword } = require('./validateEnv');
  expect(normalizeUsername('  owner  ')).toBe('owner');
  expect(() => normalizeUsername('ab')).toThrow(/3 and 50/);
  expect(validateAccountPassword('  password-with-spaces  ')).toBe('  password-with-spaces  ');
  expect(() => validateAccountPassword('short')).toThrow(/8 and 100/);
});
```

Run `npm test -- --runInBand src/utils/validateEnv.test.ts` and expect FAIL because both exports are absent.

- [ ] **Step 2: Extract the validators and preserve bootstrap behavior**

Implement:

```ts
export function normalizeUsername(raw: string): string {
  const username = raw.trim();
  if (username.length < 3 || username.length > 50) {
    throw new Error('Username must contain between 3 and 50 characters');
  }
  return username;
}

export function validateAccountPassword(password: string): string {
  if (password.length < 8 || password.length > 100) {
    throw new Error('Password must contain between 8 and 100 characters');
  }
  return password;
}
```

Refactor `normalizeAccountCredentials()` to call both functions. Run `validateEnv.test.ts` and `bootstrap_user.test.ts`; expect PASS.

- [ ] **Step 3: Write failing reset-command unit tests**

Define test dependencies with `findUsers`, `hashPassword`, `commitReset`, and `log`. Cover:

```ts
it('resets exactly one enabled canonical operator', async () => {
  deps.findUsers.mockResolvedValue([{ id: 'operator-1', username: 'owner', isDisabled: false }]);
  await expect(resetOperatorPassword({ username: ' owner ', password: 'new-password-123' }, deps))
    .resolves.toEqual({ userId: 'operator-1' });
  expect(deps.hashPassword).toHaveBeenCalledWith('new-password-123');
  expect(deps.commitReset).toHaveBeenCalledWith({
    userId: 'operator-1', passwordHash: 'bcrypt-hash', usedAt: expect.any(Date),
  });
});

it.each([
  ['missing', []],
  ['ambiguous', [
    { id: 'operator-1', username: 'owner', isDisabled: false },
    { id: 'operator-2', username: 'owner', isDisabled: false },
  ]],
  ['disabled', [{ id: 'operator-1', username: 'owner', isDisabled: true }]],
])('rejects a %s operator without hashing or mutation', async (_caseName, users) => {
  deps.findUsers.mockResolvedValue(users);
  await expect(resetOperatorPassword({ username: 'owner', password: 'new-password-123' }, deps))
    .rejects.toThrow(/operator/i);
  expect(deps.hashPassword).not.toHaveBeenCalled();
  expect(deps.commitReset).not.toHaveBeenCalled();
});

it('never logs credential material', async () => {
  deps.findUsers.mockResolvedValue([{ id: 'operator-1', username: 'owner', isDisabled: false }]);
  await resetOperatorPassword({ username: 'owner', password: 'new-password-123' }, deps);
  expect(JSON.stringify(deps.log.mock.calls)).not.toMatch(/owner|new-password-123|bcrypt-hash/);
});
```

Run `npm test -- --runInBand src/scripts/reset_operator_password.test.ts`; expect FAIL because the script does not exist.

- [ ] **Step 4: Implement the focused reset unit and production transaction**

Use these public dependency types:

```ts
export interface ResetOperatorDependencies {
  findUsers(username: string): Promise<Array<{ id: string; username: string; isDisabled: boolean }>>;
  hashPassword(password: string): Promise<string>;
  commitReset(input: { userId: string; passwordHash: string; usedAt: Date }): Promise<void>;
  now(): Date;
  log(message: string): void;
}

export async function resetOperatorPassword(
  input: { username: string; password: string },
  deps: ResetOperatorDependencies = productionDependencies,
): Promise<{ userId: string }> {
  const username = normalizeUsername(input.username);
  const password = validateAccountPassword(input.password);
  const users = await deps.findUsers(username);
  if (users.length !== 1 || users[0].username !== username || users[0].isDisabled) {
    throw new Error('Operator password reset refused: canonical enabled operator was not found exactly once');
  }
  const passwordHash = await deps.hashPassword(password);
  await deps.commitReset({ userId: users[0].id, passwordHash, usedAt: deps.now() });
  deps.log(`Operator password reset completed for user ${users[0].id}.`);
  return { userId: users[0].id };
}
```

`productionDependencies.commitReset` must use one `prisma.$transaction` and perform exactly:

```ts
await tx.user.update({
  where: { id: input.userId },
  data: { passwordHash: input.passwordHash, sessionVersion: { increment: 1 } },
});
await tx.passwordResetToken.updateMany({
  where: { userId: input.userId, usedAt: null },
  data: { usedAt: input.usedAt },
});
```

The CLI `main()` reads only `RESET_USERNAME` and `RESET_PASSWORD`. Its top-level catch prints exactly `Operator password reset failed` and sets exit code 1; it never prints the caught error.

- [ ] **Step 5: Add the image command and verify transaction source contract**

Add to `backend/package.json`:

```json
"deploy:reset-password": "node dist/scripts/reset_operator_password.js"
```

Add a test that reads the production dependency through mocks and asserts one `commitReset` call; also assert the built script exists after `npm run build`.

- [ ] **Step 6: Run focused/full verification and commit**

Run:

```powershell
npm test -- --runInBand src/utils/validateEnv.test.ts src/scripts/bootstrap_user.test.ts src/scripts/reset_operator_password.test.ts
npm test -- --runInBand
npm run build
Test-Path dist/scripts/reset_operator_password.js
```

Expected: tests PASS, build exits 0, final command prints `True`.

Commit:

```powershell
git add backend/src/utils/validateEnv.ts backend/src/utils/validateEnv.test.ts backend/src/scripts/reset_operator_password.ts backend/src/scripts/reset_operator_password.test.ts backend/package.json
git commit -m "feat: add transactional operator password reset"
```

### Task 3: Frontend Disabled-Recovery Capability

**Files:**
- Create: `frontend/lib/server/password-reset-mode.ts`
- Create: `frontend/components/auth/PasswordResetUnavailable.tsx`
- Modify: `frontend/components/auth/AuthForm.tsx:10-175`
- Modify: `frontend/app/(auth)/login/page.tsx`
- Modify: `frontend/app/(auth)/forgot-password/page.tsx`
- Modify: `frontend/app/(auth)/reset-password/page.tsx`
- Modify: `frontend/app/api/session/forgot-password/route.ts`
- Modify: `frontend/app/api/session/reset-password/route.ts`
- Modify: `frontend/test/auth-pages.test.tsx`
- Modify: `frontend/test/session-routes.test.ts`

**Interfaces:**
- Consumes: frontend server environment `PASSWORD_RESET_MODE` and the backend stable disabled code.
- Produces: `passwordResetEnabled()`, `passwordResetDisabledResponse()`, `AuthForm.passwordResetEnabled`, and the localized `PasswordResetUnavailable` state.

- [ ] **Step 1: Write failing page and login capability tests**

Update login tests to render both capability states:

```tsx
it('hides recovery when password reset is disabled', () => {
  render(<AuthForm mode="login" passwordResetEnabled={false} />);
  expect(screen.queryByRole('link', { name: 'Quên mật khẩu?' })).not.toBeInTheDocument();
});

it('keeps recovery visible in email mode', () => {
  render(<AuthForm mode="login" passwordResetEnabled />);
  expect(screen.getByRole('link', { name: 'Quên mật khẩu?' })).toHaveAttribute('href', '/forgot-password');
});
```

Add component tests asserting the unavailable state has one heading, the Vietnamese pilot message, a `/login` link, and no email/password field or submit button.

Run `npm test -- --run frontend/test/auth-pages.test.tsx`; expect TypeScript/render failures because the prop and component do not exist.

- [ ] **Step 2: Implement the server capability and unavailable component**

`frontend/lib/server/password-reset-mode.ts` must contain:

```ts
import { NextResponse } from 'next/server';

export const PASSWORD_RESET_DISABLED_BODY = {
  code: 'PASSWORD_RESET_DISABLED',
  error: 'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.',
} as const;

export function passwordResetEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const mode = env.PASSWORD_RESET_MODE?.trim();
  if (!mode && env.NODE_ENV !== 'production') return true;
  if (mode === 'disabled') return false;
  if (mode === 'email') return true;
  throw new Error('PASSWORD_RESET_MODE must be explicitly set to disabled or email in production');
}

export function passwordResetDisabledResponse() {
  return NextResponse.json(PASSWORD_RESET_DISABLED_BODY, { status: 503 });
}
```

`PasswordResetUnavailable` renders `Khôi phục mật khẩu chưa được bật`, the stable message, and `Quay lại đăng nhập` linking to `/login`.

Add `passwordResetEnabled?: boolean` to `AuthFormProps`, default it to `true` inside `AuthForm`, gate the existing recovery link, and pass `passwordResetEnabled()` explicitly from the login server page. The default preserves existing isolated component tests; production behavior still comes only from the server-derived prop. Both recovery server pages call the same function and render the unavailable component when false.

- [ ] **Step 3: Write failing disabled BFF tests**

Set `process.env.PASSWORD_RESET_MODE = 'disabled'`, call both route functions with malformed bodies from a valid origin, and assert:

```ts
expect(response.status).toBe(503);
expect(await response.json()).toEqual({
  code: 'PASSWORD_RESET_DISABLED',
  error: 'Khôi phục mật khẩu qua email chưa được bật cho bản dùng thử cá nhân.',
});
expect(mockForwardToBackend).not.toHaveBeenCalled();
```

Keep the cross-origin test: origin validation must still return 403 before the capability response.

Run `npm test -- --run frontend/test/session-routes.test.ts`; expect FAIL because routes still parse and forward.

- [ ] **Step 4: Gate both BFF routes before body parsing**

After `enforceMutationOrigin(req)` and before `req.json()`, add:

```ts
if (!passwordResetEnabled()) return passwordResetDisabledResponse();
```

Set `PASSWORD_RESET_MODE=email` in existing email-flow tests so their current behavior remains covered.

- [ ] **Step 5: Run frontend tests, lint, build, and commit**

Run:

```powershell
Set-Location frontend
npm test -- --run frontend/test/auth-pages.test.tsx frontend/test/session-routes.test.ts
npm test -- --run --maxWorkers=4
npm run lint
npm run build
```

Expected: all commands exit 0.

Commit:

```powershell
git add frontend/lib/server/password-reset-mode.ts frontend/components/auth/PasswordResetUnavailable.tsx frontend/components/auth/AuthForm.tsx 'frontend/app/(auth)/login/page.tsx' 'frontend/app/(auth)/forgot-password/page.tsx' 'frontend/app/(auth)/reset-password/page.tsx' frontend/app/api/session/forgot-password/route.ts frontend/app/api/session/reset-password/route.ts frontend/test/auth-pages.test.tsx frontend/test/session-routes.test.ts
git commit -m "feat: disable email recovery in personal pilot"
```

### Task 4: SMTP-Free Terraform Runtime and Reset Job

**Files:**
- Modify: `infra/terraform/variables.tf:45-110`
- Modify: `infra/terraform/prod.tfvars.example`
- Modify: `infra/terraform/secrets.tf:1-35`
- Modify: `infra/terraform/iam.tf:1-260`
- Modify: `infra/terraform/cloud_run.tf:225-330,470-610`
- Modify: `infra/terraform/monitoring.tf:65-90`
- Modify: `infra/terraform/outputs.tf`
- Modify: `ops/tests/TerraformPlan.Tests.ps1`

**Interfaces:**
- Consumes: backend image command `node dist/scripts/reset_operator_password.js`, existing Cloud SQL volume, bootstrap username secret, and human `operator_email`.
- Produces: `docai-password-reset` service account, `docai-admin-reset-password` secret, `docai-reset-password` Cloud Run job, output `password_reset_job`, and rendered-plan security invariants.

- [ ] **Step 1: Write failing rendered-plan assertions**

Update `TerraformPlan.Tests.ps1` to require:

```powershell
$backend = Get-Change 'google_cloud_run_v2_service.backend'
$backendEnv = @($backend.template[0].containers[0].env)
Assert-True (($backendEnv | Where-Object name -eq 'PASSWORD_RESET_MODE').value -eq 'disabled') 'backend reset mode must be disabled'
Assert-True (-not ($backendEnv.name -contains 'SMTP_USER')) 'backend must not mount SMTP_USER'
Assert-True (-not ($backendEnv.name -contains 'SMTP_PASS')) 'backend must not mount SMTP_PASS'
Assert-True (-not ($backendEnv.name -contains 'SMTP_HOST')) 'backend must not configure SMTP_HOST'

$resetJob = Get-Change 'google_cloud_run_v2_job.reset_password'
$resetContainer = $resetJob.template[0].template[0].containers[0]
Assert-True ($resetJob.name -eq 'docai-reset-password') 'reset job name'
Assert-True ($resetJob.location -eq 'asia-southeast1') 'reset job region'
Assert-True ($resetJob.template[0].template[0].max_retries -eq 0) 'reset job cannot retry'
Assert-True ($resetContainer.args -contains 'dist/scripts/reset_operator_password.js') 'reset job command'
Assert-True ($resetContainer.env.name -contains 'RESET_USERNAME') 'reset job must bind bootstrap username'
Assert-True (-not ($resetContainer.env.name -contains 'RESET_PASSWORD')) 'baseline reset job must not retain a password binding'
```

Assert that `docai-password-reset` exists, the service account has Cloud SQL/logging only, and only it can read `docai-admin-reset-password`. Run the contract against the current saved plan and expect failure for missing resources.

- [ ] **Step 2: Remove SMTP from required runtime variables without deleting empty containers**

In `variables.tf`:

- Delete `smtp_host`, `smtp_port`, and `smtp_from`.
- Add required `operator_email` with an email-shaped validation.
- Remove `smtp-user` and `smtp-pass` from the `secret_versions` default map.

Keep `smtp-user` and `smtp-pass` in `local.external_secret_ids` so their empty containers survive for a later email phase. Add `admin-reset-password` to the same set. Remove SMTP from `local.backend_secret_ids`.

In `prod.tfvars.example`, replace all SMTP fields with:

```hcl
operator_email         = "operator@example.com"
public_frontend_origin = "https://bootstrap.invalid"
```

- [ ] **Step 3: Add the disabled runtime and dedicated reset job**

Inject `PASSWORD_RESET_MODE = "disabled"` into both backend and frontend. Remove `PASSWORD_RESET_BASE_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, and `SMTP_PASS` from the backend resource.

Add `password_reset = "docai-password-reset"` to `local.service_accounts`, then add a Cloud Run v2 job with this baseline container contract:

```hcl
resource "google_cloud_run_v2_job" "reset_password" {
  provider            = google-beta
  name                = "docai-reset-password"
  location            = var.region
  deletion_protection = true
  labels              = local.labels
  template {
    template {
      service_account = google_service_account.service["password_reset"].email
      timeout         = "300s"
      max_retries     = 0
      volumes {
        name = "cloudsql"
        cloud_sql_instance { instances = [google_sql_database_instance.main.connection_name] }
      }
      containers {
        name    = "reset-password"
        image   = "${local.registry}/backend:${var.image_tag}"
        command = ["node"]
        args    = ["dist/scripts/reset_operator_password.js"]
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = google_secret_manager_secret_version.database_url.version
            }
          }
        }
        env {
          name = "RESET_USERNAME"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.external["bootstrap-username"].secret_id
              version = var.secret_versions["bootstrap-username"]
            }
          }
        }
        resources {
          limits = { cpu = "1", memory = "1Gi" }
        }
      }
    }
  }
}
```

Do not define `RESET_PASSWORD` in Terraform baseline. The owner helper adds one exact numeric binding for an execution and removes it in cleanup.

- [ ] **Step 4: Add runtime IAM, alerting, and output**

Grant the reset service account:

- `roles/cloudsql.client` at project scope.
- `roles/logging.logWriter` at project scope.
- `roles/secretmanager.secretAccessor` on `docai-database-url`, `docai-bootstrap-username`, and `docai-admin-reset-password` only.

Add `docai-reset-password` to the `failed_job` logging metric filter. Add:

```hcl
output "password_reset_job" {
  value = google_cloud_run_v2_job.reset_password.name
}
```

- [ ] **Step 5: Render and verify an offline Terraform plan**

Run formatting and initialization in an isolated data directory, then create the same contract plan shape used by the existing tests:

```powershell
$env:TF_DATA_DIR = Join-Path ([IO.Path]::GetTempPath()) "docai-reset-plan-$PID"
terraform -chdir=infra/terraform fmt -recursive
terraform -chdir=infra/terraform init -backend=false -input=false
terraform -chdir=infra/terraform validate
$imageTag = git rev-parse HEAD
terraform -chdir=infra/terraform plan -refresh=false -input=false -out=tfplan `
  -var='project_id=project-96fe5a5e-a0df-4a2f-902' `
  -var='github_owner=qminhhindahood' `
  -var="image_tag=$imageTag" `
  -var='operator_email=mnqminh@gmail.com'
pwsh -NoProfile -File ops/tests/TerraformPlan.Tests.ps1 -PlanPath infra/terraform/tfplan
Remove-Item -LiteralPath $env:TF_DATA_DIR -Recurse -Force
Remove-Item Env:TF_DATA_DIR
```

Expected: format/validate exit 0 and rendered-plan invariants PASS. The ignored `tfplan` is not staged.

- [ ] **Step 6: Commit the SMTP-free runtime and reset infrastructure**

```powershell
git add infra/terraform/variables.tf infra/terraform/prod.tfvars.example infra/terraform/secrets.tf infra/terraform/iam.tf infra/terraform/cloud_run.tf infra/terraform/monitoring.tf infra/terraform/outputs.tf ops/tests/TerraformPlan.Tests.ps1
git commit -m "feat: provision SMTP-free reset job"
```

### Task 5: Human-Only Invocation and Deployment Workflow Boundary

**Files:**
- Modify: `infra/terraform/iam.tf:145-260`
- Modify: `.github/workflows/deploy-production.yml:70-155`
- Modify: `ops/tests/TerraformPlan.Tests.ps1`
- Modify: `ops/tests/GitHubWorkflow.Tests.ps1`

**Interfaces:**
- Consumes: `var.operator_email`, the reset/migration/smoke jobs, immutable release images, and the GitHub deployer service account.
- Produces: a human-only Terraform/state boundary, custom `docaiCloudRunDeployer` role without IAM mutation or job execution, two job-level invoker bindings, and a protected deployment preflight.

- [ ] **Step 1: Write failing IAM and workflow contracts**

In `TerraformPlan.Tests.ps1`, assert the deployer custom role contains service/job create, update, get, list, and delete permissions but excludes execution and IAM-policy mutation:

```powershell
$runDeployer = Get-Change 'google_project_iam_custom_role.cloud_run_deployer'
foreach ($permission in @('run.services.create','run.services.update','run.jobs.create','run.jobs.update','run.operations.get')) {
  Assert-True ($runDeployer.permissions -contains $permission) "Cloud Run deployer missing $permission"
}
foreach ($permission in @('run.jobs.run','run.jobs.runWithOverrides','run.jobs.setIamPolicy','run.services.setIamPolicy')) {
  Assert-True ($runDeployer.permissions -notcontains $permission) "deployer must not receive $permission"
}
```

Assert the deployer has no predefined project role and has `roles/artifactregistry.writer` only on the `docai` repository, no billing or secret-management grant, and no service-account-user binding on `docai-password-reset`. Assert the operator has `roles/run.developer` only on `docai-reset-password`; the deployer has `roles/run.invoker` on `docai-migrate` and `docai-bootstrap-smoke-user`, with no reset-job invoker binding.

In `GitHubWorkflow.Tests.ps1` add:

```powershell
Assert-True ($deployRaw -notmatch 'jobs execute docai-reset-password') 'automation must never execute the break-glass reset job'
Assert-True ($deployRaw -notmatch 'smtp_from|PRODUCTION_SMTP_FROM') 'SMTP must not block the disabled-mode pilot'
Assert-True ($deployRaw -notmatch 'setup-terraform|terraform\s+-chdir|tfplan|TF_STATE_BUCKET') 'GitHub must not read Terraform state or apply infrastructure'
Assert-True ($deployRaw -match 'Verify human-applied infrastructure release') 'deploy must verify the human-applied release'
```

Run both tests and expect failure against current IAM/workflow.

- [ ] **Step 2: Replace broad deployer administration with application-only permissions**

Remove every predefined project role from the GitHub deployer and grant `roles/artifactregistry.writer` only on `google_artifact_registry_repository.docai`. Delete the obsolete billing grant and secret-deployer role/grant. Define `google_project_iam_custom_role.cloud_run_deployer` with this exact permission set:

```hcl
permissions = [
  "resourcemanager.projects.get",
  "run.jobs.create", "run.jobs.delete", "run.jobs.get", "run.jobs.getIamPolicy",
  "run.jobs.list", "run.jobs.update",
  "run.executions.get", "run.executions.list",
  "run.locations.get", "run.locations.list",
  "run.operations.get", "run.operations.list",
  "run.revisions.delete", "run.revisions.get", "run.revisions.list",
  "run.services.create", "run.services.delete", "run.services.get", "run.services.getIamPolicy",
  "run.services.list", "run.services.update",
]
```

Grant that custom role to the GitHub deployer. Keep service-account-user bindings only for the application, migration, and smoke identities; never add `password_reset`.

- [ ] **Step 3: Add resource-scoped execution and operator permissions**

Grant `roles/run.invoker` to the GitHub deployer on `docai-migrate` and `docai-bootstrap-smoke-user` only.

Grant the human `user:${var.operator_email}`:

- `roles/run.developer` on `docai-reset-password` only.
- `roles/iam.serviceAccountUser` on `docai-password-reset` only.
- `roles/secretmanager.secretVersionAdder` and `roles/secretmanager.secretVersionManager` on `docai-admin-reset-password` only.

No human or deployer role includes `secretmanager.versions.access` for the temporary password. Only the human Terraform workflow can create or change these IAM bindings.

- [ ] **Step 4: Remove Terraform from GitHub and add the human-apply preflight**

Delete the GitHub Terraform plan/apply job, state-bucket environment variable, plan artifacts, and Terraform setup. Make `deploy` depend directly on `build-images` and retain `environment: production` as the human pause.

After gcloud authentication, describe both `docai-migrate` and `docai-reset-password` and require their backend image to equal `${REGISTRY}/backend:${GITHUB_SHA}`. This proves the operator applied the reviewed Terraform release before migration. Remove `--allow-unauthenticated` and `--no-allow-unauthenticated` from deploy commands so GitHub cannot mutate service IAM; Terraform owns those bindings.

Do not add any Terraform command or reset-job execution step.

- [ ] **Step 5: Verify action syntax, contracts, Terraform plan, and commit**

Run:

```powershell
actionlint .github/workflows/ci.yml .github/workflows/deploy-production.yml
pwsh -NoProfile -File ops/tests/GitHubWorkflow.Tests.ps1
pwsh -NoProfile -File ops/tests/TerraformPlan.Tests.ps1 -PlanPath infra/terraform/tfplan
terraform -chdir=infra/terraform validate
```

Expected: all exit 0.

Commit:

```powershell
git add infra/terraform/iam.tf .github/workflows/deploy-production.yml ops/tests/TerraformPlan.Tests.ps1 ops/tests/GitHubWorkflow.Tests.ps1 docs/superpowers/specs/2026-08-11-gcp-smtp-free-personal-pilot-design.md docs/superpowers/plans/2026-08-11-gcp-smtp-free-personal-pilot.md
git commit -m "security: restrict reset job execution to operator"
```

### Task 6: Secure Owner Reset Helper and Recovery Rehearsal

**Files:**
- Create: `ops/lib/AdminPasswordReset.psm1`
- Create: `ops/gcp/reset-production-password.ps1`
- Create: `ops/tests/AdminPasswordReset.Tests.ps1`
- Modify: `ops/tests/GcpRunbooks.Tests.ps1`

**Interfaces:**
- Consumes: authenticated `gcloud`, Secret Manager REST API, `docai-admin-reset-password`, and `docai-reset-password`.
- Produces: `Invoke-DocAiAdminPasswordReset -ProjectId -Region -JobName -SecretId`, an interactive wrapper, and cleanup evidence containing version ID/state only.

- [ ] **Step 1: Write failing Pester orchestration tests**

The test module imports `AdminPasswordReset.psm1`, mocks `Add-ResetSecretVersion`, `Set-ResetJobSecret`, `Invoke-ResetJob`, `Remove-ResetJobSecret`, and `Disable-ResetSecretVersion`, and asserts exact order.

Success contract:

```powershell
It 'binds one numeric version, waits for the job, removes the binding, and disables the version' {
  Mock Add-ResetSecretVersion { '7' }
  Mock Set-ResetJobSecret {}
  Mock Invoke-ResetJob {}
  Mock Remove-ResetJobSecret {}
  Mock Disable-ResetSecretVersion {}

  Invoke-DocAiAdminPasswordReset -ProjectId 'project-1' -Region 'asia-southeast1' `
    -JobName 'docai-reset-password' -SecretId 'docai-admin-reset-password' `
    -Password (ConvertTo-SecureString 'new-password-123' -AsPlainText -Force)

  Should -Invoke Set-ResetJobSecret -Times 1 -ParameterFilter { $Version -eq '7' }
  Should -Invoke Invoke-ResetJob -Times 1
  Should -Invoke Remove-ResetJobSecret -Times 1
  Should -Invoke Disable-ResetSecretVersion -Times 1 -ParameterFilter { $Version -eq '7' }
}
```

Failure contract: make `Invoke-ResetJob` throw, assert the function rethrows only after both cleanup mocks run once. Add a test that neither captured output nor exception text contains the test password.

Run Pester 5 on the new file; expect import failure because the module does not exist.

- [ ] **Step 2: Implement in-memory Secret Manager version creation**

`Add-ResetSecretVersion` must:

1. Convert the supplied `SecureString` to plaintext only inside a `try/finally` block.
2. Encode UTF-8 bytes and Base64 in memory.
3. Obtain an access token with `gcloud auth print-access-token`.
4. POST this JSON body to `https://secretmanager.googleapis.com/v1/projects/$ProjectId/secrets/$SecretId:addVersion`:

```powershell
$body = @{ payload = @{ data = [Convert]::ToBase64String($bytes) } } | ConvertTo-Json -Compress
```

5. Parse the numeric final segment from the returned `name`.
6. Zero the byte array, zero/free the BSTR, and clear the plaintext, request-body, and access-token variables in `finally`.

The function returns only the numeric version string. It never writes the body, token, or password.

- [ ] **Step 3: Implement metadata-only gcloud operations and finally cleanup**

Use these exact commands through the repository's checked native-command pattern:

```powershell
gcloud run jobs update $JobName --project $ProjectId --region $Region `
  --update-secrets "RESET_PASSWORD=${SecretId}:${Version}" --quiet
gcloud run jobs execute $JobName --project $ProjectId --region $Region --wait --quiet
gcloud run jobs update $JobName --project $ProjectId --region $Region `
  --remove-secrets RESET_PASSWORD --quiet
gcloud secrets versions disable $Version --secret $SecretId --project $ProjectId --quiet
```

Wrap binding/execution in `try/finally`. Cleanup errors are accumulated and thrown as `Operator reset cleanup failed for secret version <N>` without replacing an earlier job error until both cleanup actions have been attempted.

- [ ] **Step 4: Implement the thin interactive script**

The wrapper requires `ProjectId` and `Region`, defaults job/secret names to the approved constants, verifies the active gcloud account, prints project/region/account/job, and requires the operator to type the exact project ID as confirmation.

Prompt twice with `Read-Host -AsSecureString`, compare without displaying plaintext, validate 8-100 UTF-16 code units, and call `Invoke-DocAiAdminPasswordReset`. Do not accept a password parameter.

- [ ] **Step 5: Extend runbook source contracts**

Add the reset script to `GcpRunbooks.Tests.ps1`. Assert it has mandatory `ProjectId`/`Region`, contains `Read-Host -AsSecureString`, uses an exact numeric secret version, removes the secret binding, disables the version, and never uses `--password`, `--update-env-vars RESET_PASSWORD`, `Write-Host $Password`, or `secrets versions access`.

- [ ] **Step 6: Run Pester 5 and commit**

Run:

```powershell
pwsh -NoProfile -Command "Import-Module '$PWD/.artifacts/pester5/Pester/5.7.1/Pester.psd1' -Force; Invoke-Pester -Path '$PWD/ops/tests/AdminPasswordReset.Tests.ps1','$PWD/ops/tests/GcpRunbooks.Tests.ps1' -Output Detailed"
```

Expected: zero failed tests. If the ignored Pester 5 module is absent, restore it with `Save-Module Pester -RequiredVersion 5.7.1 -Path .artifacts/pester5` before running.

Commit:

```powershell
git add ops/lib/AdminPasswordReset.psm1 ops/gcp/reset-production-password.ps1 ops/tests/AdminPasswordReset.Tests.ps1 ops/tests/GcpRunbooks.Tests.ps1
git commit -m "feat: add secure operator reset helper"
```

### Task 7: Production Smoke, Owner Documentation, and Full Release Verification

**Files:**
- Modify: `ops/gcp/smoke-production.ps1`
- Modify: `docs/operations/gcp-owner-action-guide.md`
- Modify: `docs/operations/gcp-production-runbook.md`
- Modify: `README.md`
- Modify: `ops/tests/GcpRunbooks.Tests.ps1`
- Modify: `ops/tests/RepositoryHygiene.Tests.ps1`

**Interfaces:**
- Consumes: disabled backend/frontend behavior, reset helper, Terraform job/IAM, and existing CI/verifier.
- Produces: current owner instructions, disabled-mode smoke evidence, repository regression contracts, and a reviewed no-mutation release checkpoint.

- [ ] **Step 1: Write failing smoke/runbook contracts**

Require `smoke-production.ps1` to POST valid forgot/reset bodies and accept only 503 with `PASSWORD_RESET_DISABLED`. Require the owner guide to list exactly three remaining launch secrets:

```text
docai-bootstrap-username
docai-bootstrap-email
docai-bootstrap-password
```

Assert the guide does not instruct the owner to configure Gmail, SendPulse, a domain, `docai-smtp-user`, or `docai-smtp-pass` for the initial launch.

Run the Pester/source contracts and expect failure against current documentation.

- [ ] **Step 2: Add disabled recovery to production smoke**

After readiness and before login, send a same-origin POST to each BFF endpoint:

```powershell
$forgot = Invoke-WebRequest "$FrontendUrl/api/session/forgot-password" -Method Post `
  -ContentType 'application/json' -Headers @{ Origin = $origin } `
  -Body (@{ email = 'operator@example.invalid' } | ConvertTo-Json) -SkipHttpErrorCheck
Assert-Status 'email password recovery disabled' $forgot @(503)
if (($forgot.Content | ConvertFrom-Json).code -ne 'PASSWORD_RESET_DISABLED') {
  throw 'Forgot-password endpoint did not return PASSWORD_RESET_DISABLED'
}
```

Use a canonical 43-character token and valid password for the reset endpoint, require the same code, and never print either value.

- [ ] **Step 3: Rewrite the owner guide around three remaining secrets**

Update `Last checked` to `2026-08-11`. Remove the SMTP preparation section and all five-secret wording. State that the personal email is only the account identifier, email recovery is intentionally unavailable, and the break-glass helper is the recovery path.

Add the exact recovery command:

```powershell
pwsh -NoProfile -File ops/gcp/reset-production-password.ps1 `
  -ProjectId project-96fe5a5e-a0df-4a2f-902 `
  -Region asia-southeast1
```

State that the command prompts securely, disables its temporary version, invalidates old sessions, and requires a new login test.

- [ ] **Step 4: Update the production runbook and README**

The runbook must make these release gates explicit:

- No SMTP/domain requirement for the single-operator phase.
- Operator bootstrap secrets are present.
- Disabled recovery smoke passes.
- Reset helper rehearsal passes only against disposable data before launch.
- Live reset job is never run as a deployment smoke action.

README must point production operators to the amended design and owner guide without advertising email reset as active.

- [ ] **Step 5: Run all local verification with Docker available**

Ask the user to start Docker Desktop before this step. Then run:

```powershell
pwsh -NoProfile -File ops/verify-all.ps1
actionlint .github/workflows/ci.yml .github/workflows/deploy-production.yml
git diff --check
```

Expected evidence:

- Backend, frontend, renderer, and Python suites have zero failures.
- Compose contracts pass.
- Terraform formatting and validation pass.
- Pester 5 operations tests have zero failures, with only explicitly pending live integrations skipped.
- Actionlint and whitespace checks exit 0.

- [ ] **Step 6: Build and scan the changed production images**

Build backend and frontend using the exact production Dockerfiles and run Trivy 0.70.0 (the version selected by the SHA-pinned CI action) with `--scanners vuln --severity HIGH,CRITICAL --ignore-unfixed=false --exit-code 1`. Also run Gitleaks 8.24.3 on the staged diff. The earlier 0.66.0 release is no longer available from the official release repository.

Expected: both images build; both vulnerability scans exit 0; Gitleaks reports no leaks.

- [ ] **Step 7: Generate a reviewed remote-backend Terraform plan without applying it**

Keep `PRODUCTION_ENABLED=false`. Authenticate with the existing human gcloud account, initialize the configured remote state backend, and run `terraform plan` with the exact project, owner, commit SHA, operator email, and bootstrap origin inputs. Save the ignored plan and text rendering under `.artifacts/releases/<commit>/`.

Review for:

- No unexpected destroy action.
- No Cloud Run/Cloud SQL creation outside the approved resources.
- No SMTP secret version access or backend binding.
- One private `docai-reset-password` job with no baseline password binding.
- Dedicated reset identity and exact IAM boundaries.
- No production traffic change.

Do not run `terraform apply` in this task.

- [ ] **Step 8: Commit documentation and verification contracts**

```powershell
git add ops/gcp/smoke-production.ps1 docs/operations/gcp-owner-action-guide.md docs/operations/gcp-production-runbook.md README.md ops/tests/GcpRunbooks.Tests.ps1 ops/tests/RepositoryHygiene.Tests.ps1
git commit -m "docs: operationalize SMTP-free pilot"
```

- [ ] **Step 9: Final branch review, secret scan, push, and CI**

Run:

```powershell
git status --short
git log --oneline origin/master..HEAD
& '.artifacts/gitleaks-v8.24.3/gitleaks.exe' git --log-opts="origin/master..HEAD" --redact
git push origin master
```

Dispatch `.github/workflows/ci.yml` at the new `master` SHA and wait for every job, including all container vulnerability gates and repository contracts, to conclude `success`.

Keep `PRODUCTION_ENABLED=false`. Production apply and traffic promotion require a separate explicit user authorization after CI and Terraform plan review.

## Plan Self-Review Record

- Spec coverage: every fixed decision, runtime behavior, HTTP behavior, reset transaction, temporary-secret lifecycle, IAM boundary, monitoring change, testing layer, rollout gate, rollback constraint, and later-email boundary maps to Tasks 1-7.
- Scope: the work is one deployable capability; frontend, backend, infrastructure, and operations changes cannot independently satisfy the approved pilot.
- Placeholder scan: the plan contains no unresolved implementation markers or unspecified error-handling steps.
- Type consistency: both tiers use `PASSWORD_RESET_MODE`, `PASSWORD_RESET_DISABLED`, and the same Vietnamese message; the reset command uses `RESET_USERNAME` and `RESET_PASSWORD`; Terraform and the helper use `docai-reset-password` and `docai-admin-reset-password` consistently.
- Safety: no step enables production, applies the remote Terraform plan, executes the live reset job, or asks for a secret value in chat.
