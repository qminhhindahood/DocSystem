# Data Safety and User-Only Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish trustworthy Prisma history, one database-revalidated user session type, strict owner scoping, safe provider URLs, and remove all admin/reviewer/LoRA runtime surfaces without deleting legacy data.

**Architecture:** Prisma migrations stage nullable additions and backfills before constraints. Interactive authorization contains only a user identity; explicit `SystemAccess` is available only to imported maintenance/evaluation code. Provider requests use validated/pinned destinations, while obsolete privileged routes and workers are removed from the runtime graph.

**Tech Stack:** TypeScript, Express, Jest/Supertest, Prisma 5, PostgreSQL 15/pgvector, JWT HS256, Zod, Axios.

## Global Constraints

- Do not mutate the live database or edit an already-applied migration.
- Preserve legacy admin/review/training/model data in tables while removing runtime access.
- Keep `Document.ownerId` required with the system-owner database default.
- Cross-owner resource requests return 404; authentication failures return 401.
- Commit only files named by the current task.

---

### Task 1: Repair Migration History and Stage the User-Owned Template Schema

**Files:**
- Restore: `backend/prisma/migrations/20250608000000_rename_ollama_to_lmstudio/migration.sql`
- Restore: `backend/prisma/migrations/20260513195302_init/migration.sql`
- Replace uncommitted migration: `backend/prisma/migrations/20260712184012_init_dynamic_templates/migration.sql`
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/scripts/check_migration_integrity.test.ts`
- Create: `backend/scripts/deploy_fresh_database.ts`
- Create: `backend/scripts/deploy_fresh_database.test.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: `TemplateStatus` Prisma enum and owner-linked `Template` records consumed by Phase 2.
- Preserves: `SYSTEM_OWNER_ID = "00000000-0000-0000-0000-000000000001"` and the `Document.ownerId` default.
- Produces: an empty-target-only baseline helper that marks `20250608000000_rename_ollama_to_lmstudio` applied before `prisma migrate deploy` and refuses any database containing application tables.

- [ ] **Step 1: Write the failing migration-integrity test**

Create a test that reads the two published migration files from commit `e4800fc`, hashes their bytes, compares them with the worktree, and inspects the staged migration for forbidden destructive statements:

```ts
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const published = [
  'backend/prisma/migrations/20250608000000_rename_ollama_to_lmstudio/migration.sql',
  'backend/prisma/migrations/20260513195302_init/migration.sql',
];
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

test.each(published)('%s is byte-identical to the published migration', (file) => {
  const committed = execFileSync('git', ['show', `e4800fc:${file}`]);
  expect(sha(readFileSync(join(repoRoot, file)))).toBe(sha(committed));
});

test('template adoption is additive and preserves the document owner default', () => {
  const sql = readFileSync(join(repoRoot,
    'backend/prisma/migrations/20260712184012_init_dynamic_templates/migration.sql'), 'utf8');
  expect(sql).not.toMatch(/DROP COLUMN\s+"(?:header|signatureBlock)"/i);
  expect(sql).not.toMatch(/ALTER COLUMN\s+"ownerId"\s+DROP DEFAULT/i);
  expect(sql).toContain('DROP INDEX IF EXISTS "Template_docType_key"');
  expect(sql).toContain('ALTER COLUMN "ownerId" SET NOT NULL');
  expect(sql).toContain('ALTER COLUMN "ownerId" SET DEFAULT');
  expect(sql).toContain('ALTER COLUMN "status" SET DEFAULT \'REJECTED\'');
});
```

- [ ] **Step 2: Run the test and observe the current drift/destructive SQL**

Run: `cd backend && npx jest scripts/check_migration_integrity.test.ts --runInBand`

Expected: FAIL on both changed published hashes and/or the destructive template migration.

- [ ] **Step 3: Restore the two published files and replace the uncommitted template migration**

Use `git show e4800fc:<path>` only as the byte source and apply the exact bytes with `apply_patch`; do not use checkout/reset. Replace the uncommitted migration with:

```sql
DO $$ BEGIN
  CREATE TYPE "TemplateStatus" AS ENUM
    ('UPLOADED', 'ANALYZING', 'NEEDS_REVIEW', 'READY', 'REJECTED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Template"
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "originalPath" TEXT,
  ADD COLUMN IF NOT EXISTS "originalSha256" TEXT,
  ADD COLUMN IF NOT EXISTS "fileSize" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "status" "TemplateStatus" NOT NULL DEFAULT 'UPLOADED',
  ADD COLUMN IF NOT EXISTS "semanticMap" JSONB,
  ADD COLUMN IF NOT EXISTS "generationSchema" JSONB,
  ADD COLUMN IF NOT EXISTS "analysisConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "compatibilityReport" JSONB,
  ADD COLUMN IF NOT EXISTS "previewMetadata" JSONB,
  ADD COLUMN IF NOT EXISTS "rejectionCode" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT;

INSERT INTO "User" ("id", "username", "passwordHash", "role", "isDisabled", "createdAt", "updatedAt")
VALUES ('00000000-0000-0000-0000-000000000001', 'system-owner', '!system-owner-disabled!', 'user', true, NOW(), NOW())
ON CONFLICT ("id") DO UPDATE SET "isDisabled" = true;

UPDATE "Template"
SET "ownerId" = '00000000-0000-0000-0000-000000000001',
    "status" = 'REJECTED',
    "rejectionCode" = 'LEGACY_STATIC_RETIRED',
    "rejectionReason" = 'Legacy generated template retained for audit only'
WHERE "ownerId" IS NULL;

DROP INDEX IF EXISTS "Template_docType_key";
ALTER TABLE "Template"
  ALTER COLUMN "ownerId" SET NOT NULL,
  ALTER COLUMN "ownerId" SET DEFAULT '00000000-0000-0000-0000-000000000001',
  ALTER COLUMN "status" SET DEFAULT 'REJECTED',
  ALTER COLUMN "header" SET DEFAULT '',
  ALTER COLUMN "signatureBlock" SET DEFAULT '';
CREATE INDEX IF NOT EXISTS "Template_ownerId_status_idx" ON "Template"("ownerId", "status");
CREATE INDEX IF NOT EXISTS "Template_ownerId_createdAt_idx" ON "Template"("ownerId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "Template" ADD CONSTRAINT "Template_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserDocumentProfile" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL,
  "agencyName" TEXT,
  "agencyCode" TEXT,
  "defaultPlace" TEXT,
  "defaultRecipients" JSONB,
  "signatoryName" TEXT,
  "signatoryTitle" TEXT,
  "documentNumberPrefix" TEXT,
  "nextDocumentNumber" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserDocumentProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserDocumentProfile_userId_key" UNIQUE ("userId"),
  CONSTRAINT "UserDocumentProfile_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
```

Update Prisma with the exact target model while retaining legacy columns:

```prisma
enum TemplateStatus {
  UPLOADED
  ANALYZING
  NEEDS_REVIEW
  READY
  REJECTED
  FAILED
}

model Template {
  id                  String         @id @default(uuid())
  ownerId             String         @default("00000000-0000-0000-0000-000000000001")
  owner               User           @relation(fields: [ownerId], references: [id], onDelete: Restrict)
  name                String
  docType             String?
  header              String         @default("")
  signatureBlock      String         @default("")
  description         String?
  originalPath        String?
  originalSha256      String?
  fileSize            Int            @default(0)
  status              TemplateStatus @default(REJECTED)
  semanticMap         Json?
  generationSchema    Json?
  analysisConfidence  Float?
  compatibilityReport Json?
  previewMetadata     Json?
  rejectionCode       String?
  rejectionReason     String?
  isActive            Boolean        @default(true)
  createdAt           DateTime       @default(now())
  updatedAt           DateTime       @updatedAt

  @@index([ownerId, status])
  @@index([ownerId, createdAt])
  @@index([isActive])
}

model UserDocumentProfile {
  id                   String   @id @default(uuid())
  userId               String   @unique
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  agencyName           String?
  agencyCode           String?
  defaultPlace         String?
  defaultRecipients    Json?
  signatoryName        String?
  signatoryTitle       String?
  documentNumberPrefix String?
  nextDocumentNumber   Int      @default(1)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}
```

Add `@default("00000000-0000-0000-0000-000000000001")` to `Document.ownerId` so Prisma matches its retained database default. Add `templates Template[]` and `documentProfile UserDocumentProfile?` to `User`. Remove `@unique` from `Template.docType`. Do not remove legacy `role`, `TrainingJob`, `ModelVersion`, or feedback review fields. Add `"test:migrations": "jest scripts/check_migration_integrity.test.ts --runInBand"` to `backend/package.json`.

Implement `deploy_fresh_database.ts` to query `pg_catalog` through the target `DATABASE_URL`, allow only an empty `public` schema with no non-extension application objects and no `_prisma_migrations` table, run `npx prisma migrate resolve --applied 20250608000000_rename_ollama_to_lmstudio`, then run `npx prisma migrate deploy`. Unit tests mock checked native execution and prove populated, unreachable, existing-migration-table, and ambiguous targets fail before `migrate resolve`. Expose it as `"prisma:deploy:fresh": "tsx scripts/deploy_fresh_database.ts"`. This helper is never used for an existing Prisma-managed database.

- [ ] **Step 4: Generate and validate Prisma, then rerun the focused test**

Run: `cd backend && npx prisma format && npx prisma generate && npx prisma validate && npx jest scripts/check_migration_integrity.test.ts --runInBand`

Expected: all commands exit 0 and the integrity test passes.

- [ ] **Step 5: Commit the migration boundary**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20250608000000_rename_ollama_to_lmstudio/migration.sql backend/prisma/migrations/20260513195302_init/migration.sql backend/prisma/migrations/20260712184012_init_dynamic_templates/migration.sql backend/scripts/check_migration_integrity.test.ts backend/scripts/deploy_fresh_database.ts backend/scripts/deploy_fresh_database.test.ts backend/package.json
git commit -m "fix: stage user-owned template migration"
```

### Task 2: Replace Role-Bearing JWTs with Database-Revalidated User Sessions

**Files:**
- Modify: `backend/src/middleware/user_auth.ts`
- Replace: `backend/src/middleware/auth.ts`
- Modify: `backend/src/routes/auth.ts`
- Modify: `backend/src/middleware/user_auth_security.test.ts`
- Create: `backend/src/routes/auth.contract.test.ts`

**Interfaces:**
- Produces: `AuthPayload = { userId: string; username: string; tokenUse: 'user' }`.
- Produces: `generateToken(user: { userId: string; username: string }): string`.
- Produces: `optionalUserAuthMiddleware(req, res, next): Promise<void>`; an invalid supplied token returns 401 rather than becoming anonymous.

- [ ] **Step 1: Add failing token-use, disabled-user, and response-shape tests**

```ts
it('rejects a validly signed token with no user tokenUse', async () => {
  verify.mockReturnValue({ userId: 'u1', username: 'alice', role: 'admin' });
  await userAuthMiddleware(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});

it('rejects a disabled account after JWT verification', async () => {
  verify.mockReturnValue({ userId: 'u1', username: 'alice', tokenUse: 'user' });
  prisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'alice', isDisabled: true });
  await userAuthMiddleware(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
});

it('never returns role in registration, login, or me', async () => {
  const response = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'correct-password' });
  expect(response.body.user).not.toHaveProperty('role');
});
```

- [ ] **Step 2: Run focused tests to verify failure**

Run: `cd backend && npx jest src/middleware/user_auth_security.test.ts src/routes/auth.contract.test.ts --runInBand`

Expected: FAIL because current tokens accept roles and middleware does not reload the account.

- [ ] **Step 3: Implement one user token type and DB revalidation**

Use this public shape:

```ts
export interface AuthPayload {
  userId: string;
  username: string;
  tokenUse: 'user';
}

const claims = jwt.verify(token, secret, verifyOptions) as Partial<AuthPayload>;
if (claims.tokenUse !== 'user' || typeof claims.userId !== 'string' || typeof claims.username !== 'string') {
  throw new Error('Invalid token claims');
}
const account = await prisma.user.findUnique({
  where: { id: claims.userId },
  select: { id: true, username: true, isDisabled: true },
});
if (!account || account.isDisabled || account.username !== claims.username) throw new Error('Inactive account');
req.user = { userId: account.id, username: account.username, tokenUse: 'user' };
next();
```

Remove `requireAdmin` and the development admin bypass. Replace `auth.ts` with an optional user verifier that calls the same verification helper; missing Authorization continues anonymously, but an invalid supplied token returns 401. Register/login sign only `{ userId, username, tokenUse: 'user' }`; `/me` selects `id`, `username`, timestamps, and safe LLM metadata, never `role`.

- [ ] **Step 4: Rerun focused and middleware tests**

Run: `cd backend && npx jest src/middleware/user_auth_security.test.ts src/routes/auth.contract.test.ts src/middleware/security_regressions.test.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/user_auth.ts backend/src/middleware/auth.ts backend/src/routes/auth.ts backend/src/middleware/user_auth_security.test.ts backend/src/routes/auth.contract.test.ts
git commit -m "fix: revalidate user sessions against the database"
```

### Task 3: Make Document, RAG, Workflow, and Feedback Access User-Only

**Files:**
- Modify: `backend/src/utils/document_access.ts`
- Modify: `backend/src/routes/documents.ts`
- Modify: `backend/src/routes/rag.ts`
- Modify: `backend/src/routes/qa.ts`
- Modify: `backend/src/routes/workflow.ts`
- Modify: `backend/src/routes/feedback.ts`
- Modify: `backend/src/services/feedback_service.ts`
- Modify: `backend/src/services/ingestion_service.ts`
- Modify: `backend/src/services/rag_service.ts`
- Test: `backend/src/services/document_ownership.test.ts`
- Test: `backend/src/utils/document_access.test.ts`
- Test: `backend/src/routes/{documents,rag,qa,workflow,feedback}.contract.test.ts`

**Interfaces:**
- Produces: `AccessScope = { kind: 'user'; userId: string } | { kind: 'system' }`.
- Produces: `documentWhere(scope): { ownerId: string } | {}` and `ragOwnerId(scope): string | undefined`.
- Consumes: `req.user.userId` from Task 2.

- [ ] **Step 1: Write failing cross-user and missing-auth tests**

For every list/detail/status/export/search/index/generate/QA/feedback route, assert no token is 401 and a user-A request includes `ownerId: 'user-a'` in the Prisma or SQL call. Add this direct SQL regression:

```ts
expect(sql).toMatch(/d\."ownerId"\s*=\s*\$\d+/);
expect(params).toContain('user-a');
expect(results).not.toContainEqual(expect.objectContaining({ documentId: 'user-b-document' }));
```

Feedback must use `documentId` plus owner in one database predicate and return 404 for a foreign document.

- [ ] **Step 2: Run the ownership suites and observe failures**

Run: `cd backend && npx jest src/services/document_ownership.test.ts src/utils/document_access.test.ts src/routes/documents.contract.test.ts src/routes/rag.contract.test.ts src/routes/qa.contract.test.ts src/routes/workflow.contract.test.ts src/routes/feedback.contract.test.ts --runInBand`

Expected: FAIL where admin/global/optional access remains.

- [ ] **Step 3: Implement explicit user/system scopes**

```ts
export type AccessScope = { kind: 'user'; userId: string } | { kind: 'system' };
export const SYSTEM_ACCESS: AccessScope = { kind: 'system' };
export const accessFromRequest = (req: Request): AccessScope => {
  if (!req.user?.userId) throw new Error('Authenticated user is required');
  return { kind: 'user', userId: req.user.userId };
};
export const documentWhere = (scope: AccessScope) =>
  scope.kind === 'system' ? {} : { ownerId: scope.userId };
export const ragOwnerId = (scope: AccessScope) =>
  scope.kind === 'system' ? undefined : scope.userId;
```

Require `userAuthMiddleware, requireAuth` on all application routes. Pass `{ kind: 'user', userId }` through ingestion/reindex/document creation. Keep `SYSTEM_ACCESS` imports limited to scripts and explicit maintenance jobs. Remove feedback statistics/training readiness from submission and return only `{ success, feedbackId, editType }`.

- [ ] **Step 4: Rerun the access suites**

Run the Step 2 command.

Expected: PASS; SQL-owner assertion proves filtering occurs before ranking.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/document_access.ts backend/src/routes/documents.ts backend/src/routes/rag.ts backend/src/routes/qa.ts backend/src/routes/workflow.ts backend/src/routes/feedback.ts backend/src/services/feedback_service.ts backend/src/services/ingestion_service.ts backend/src/services/rag_service.ts backend/src/services/document_ownership.test.ts backend/src/utils/document_access.test.ts backend/src/routes/*.contract.test.ts
git commit -m "fix: enforce user ownership across document workflows"
```

### Task 4: Pin User-Configured Provider Destinations

**Files:**
- Replace: `backend/src/utils/urlGuard.ts`
- Modify: `backend/src/services/llm_config_service.ts`
- Modify: `backend/src/routes/llm-settings.ts`
- Modify: `backend/src/services/llm_config_security.test.ts`
- Modify: `backend/.env.example`
- Modify: `.env.example`

**Interfaces:**
- Produces: `validateProviderTarget(baseUrl, provider, allowlist): Promise<ValidatedProviderTarget>`.
- `ValidatedProviderTarget = { baseUrl: string; hostname: string; addresses: ReadonlyArray<{ address: string; family: 4 | 6 }> }`.

- [ ] **Step 1: Add failing exact-allowlist and revalidation tests**

```ts
await expect(validateProviderTarget('http://192.168.1.20:1234', 'lmstudio', ['host.docker.internal:1234']))
  .rejects.toThrow('not in LOCAL_LLM_HOST_ALLOWLIST');
await expect(validateProviderTarget('http://169.254.169.254', 'lmstudio', ['169.254.169.254:80']))
  .rejects.toThrow('metadata');
expect(axios.post).toHaveBeenCalledWith(expect.any(String), expect.anything(), expect.objectContaining({ maxRedirects: 0 }));
expect(validateProviderTargetMock.mock.invocationCallOrder.at(-1))
  .toBeLessThan(axios.post.mock.invocationCallOrder.at(-1)!);
```

Cover loopback, RFC1918, IPv4-mapped IPv6, `::1`, ULA/link-local IPv6, metadata hostnames/IPs, credentials in URLs, non-default ports, DNS with mixed public/private answers, and an allowlisted `host.docker.internal:1234`.

- [ ] **Step 2: Run and observe current broad local-provider bypass**

Run: `cd backend && npx jest src/services/llm_config_security.test.ts --runInBand`

Expected: FAIL because provider name currently authorizes arbitrary private destinations.

- [ ] **Step 3: Implement exact origin allowlisting and request-time validation**

Parse `LOCAL_LLM_HOST_ALLOWLIST` as comma-separated normalized `hostname:port` entries. Always block metadata, URL credentials, non-HTTP(S), and mixed private/public DNS. Public providers require all resolved addresses public. Local providers may use private addresses only when the normalized host/port exactly matches the operator allowlist. Call validation when saving, testing, loading stored config, and immediately before each streaming/non-streaming HTTP request. Keep `maxRedirects: 0`; use a pinned Node `lookup` callback built from `ValidatedProviderTarget.addresses` so Axios cannot perform an independent DNS resolution.

- [ ] **Step 4: Rerun security tests and build**

Run: `cd backend && npx jest src/services/llm_config_security.test.ts src/utils/validateEnv.test.ts --runInBand && npm run build`

Expected: PASS and build exits 0.

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/urlGuard.ts backend/src/services/llm_config_service.ts backend/src/routes/llm-settings.ts backend/src/services/llm_config_security.test.ts backend/.env.example .env.example
git commit -m "fix: pin user-configured LLM destinations"
```

### Task 5: Add Private Document Defaults and Atomic Number Reservation

**Files:**
- Create: `backend/src/routes/document-profile.ts`
- Create: `backend/src/routes/document-profile.contract.test.ts`
- Create: `backend/src/services/document_profile_service.ts`
- Create: `backend/src/services/document_profile_service.test.ts`
- Modify: `backend/src/index.ts`

**Interfaces:**
- Produces owner-scoped `GET /api/settings/document-profile` and `PUT /api/settings/document-profile`.
- Produces: `reserveDocumentNumber(userId: string): Promise<string | null>`.

- [ ] **Step 1: Write failing ownership, validation, and concurrency tests**

Assert both routes require user auth, only read/write `req.user.userId`, trim optional values, accept at most 50 default recipients, reject `nextDocumentNumber` from the client, and never expose another user's profile. Run two concurrent reservations against a test transaction and assert distinct sequential values such as `12/ABC` and `13/ABC`.

- [ ] **Step 2: Run and observe missing route/service**

Run: `cd backend && npx jest src/routes/document-profile.contract.test.ts src/services/document_profile_service.test.ts --runInBand`

Expected: FAIL.

- [ ] **Step 3: Implement the profile API and atomic sequence update**

Validate lengths (`agencyName`/`defaultPlace`/names/titles 200, `agencyCode`/prefix 50, each recipient 300). Upsert only user-editable fields. Reserve numbers with one parameterized `UPDATE ... SET "nextDocumentNumber" = "nextDocumentNumber" + 1 ... RETURNING "nextDocumentNumber" - 1, "documentNumberPrefix"`; format `<number>/<prefix>` when a prefix exists and return the number alone otherwise. Return `null` if no profile exists so generation can require explicit input instead of inventing a number.

- [ ] **Step 4: Rerun focused tests and build**

Run: `cd backend && npx jest src/routes/document-profile.contract.test.ts src/services/document_profile_service.test.ts --runInBand && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/document-profile.ts backend/src/routes/document-profile.contract.test.ts backend/src/services/document_profile_service.ts backend/src/services/document_profile_service.test.ts backend/src/index.ts
git commit -m "feat: add private document generation defaults"
```

### Task 6: Remove Admin, Reviewer, Training, Activation, and LoRA Runtime Surfaces

**Files:**
- Delete: `backend/src/middleware/admin_auth.ts`
- Delete: `backend/src/routes/admin/auth.ts`
- Delete: `backend/src/routes/admin/feedback.ts`
- Delete: `backend/src/routes/admin/model-versions.ts`
- Delete: `backend/src/routes/admin/training.ts`
- Delete: `backend/src/services/feedback_rag_promotion.ts`
- Delete: `backend/src/services/feedback_rag_promotion.test.ts`
- Delete: `backend/src/services/model_version_service.ts`
- Delete: `backend/src/services/training_auto_check.ts`
- Delete: `backend/src/services/training_data_exporter.ts`
- Delete: `lora-service/Dockerfile`
- Delete: `lora-service/main.py`
- Delete: `lora-service/requirements.txt`
- Modify: `backend/src/index.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/src/utils/validateEnv.test.ts`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `backend/.env.example`
- Create: `backend/src/routes/removed_surfaces.contract.test.ts`

**Interfaces:**
- Removes all `/api/admin/**`, global review/promotion/statistics, training jobs, model activation, and LoRA HTTP/service dependencies.
- Preserves corresponding Prisma models and database columns.

- [ ] **Step 1: Write failing absence tests**

```ts
test.each([
  '/api/admin/auth/login',
  '/api/admin/feedback/review-queue',
  '/api/admin/training/jobs',
  '/api/admin/models/versions',
  '/api/feedback/stats',
  '/api/feedback/training-check',
])('%s is not a runtime route', async (path) => {
  expect((await request(app).get(path)).status).toBe(404);
});
```

Add a Compose assertion that parsed service keys exclude `lora` and environment keys exclude `LORA_SERVICE_URL`.

- [ ] **Step 2: Run tests to verify current routes exist**

Run: `cd backend && npx jest src/routes/removed_surfaces.contract.test.ts --runInBand`

Expected: FAIL for mounted routes.

- [ ] **Step 3: Remove runtime files and imports without a destructive migration**

Delete the named runtime files, route imports/mounts/health entries, LoRA Compose service/volume/dependencies, and admin/LoRA environment validation. Keep `Feedback`, `TrainingJob`, and `ModelVersion` in `schema.prisma`. Ensure feedback submission performs no promotion, approval, or training-readiness work.

- [ ] **Step 4: Verify absence, schema preservation, and Compose**

Run: `cd backend && npx jest src/routes/removed_surfaces.contract.test.ts src/routes/feedback.contract.test.ts --runInBand && npx prisma validate && npm run build`; then `docker compose config --quiet`.

Expected: all pass; Compose has no LoRA service and Prisma still exposes legacy data models.

- [ ] **Step 5: Commit**

```bash
git add -A backend/src/middleware/admin_auth.ts backend/src/routes/admin backend/src/services/feedback_rag_promotion.ts backend/src/services/feedback_rag_promotion.test.ts backend/src/services/model_version_service.ts backend/src/services/training_auto_check.ts backend/src/services/training_data_exporter.ts lora-service backend/src/index.ts backend/src/utils/validateEnv.ts backend/src/utils/validateEnv.test.ts docker-compose.yml .env.example backend/.env.example backend/src/routes/removed_surfaces.contract.test.ts
git commit -m "refactor: remove privileged and LoRA runtime features"
```

### Task 7: Prove Phase 1 on a Disposable PostgreSQL Database

**Files:**
- Create: `ops/test-migrations.ps1`
- Create: `backend/scripts/assert_owner_integrity.ts`
- Modify: `backend/package.json`

**Interfaces:**
- Produces: repeatable `npm run verify:ownership -- --database-url <url>` and disposable migration command used by Phase 4.

- [ ] **Step 1: Add owner-integrity assertions**

The script must fail unless all conditions are true:

```sql
SELECT COUNT(*) FROM "Document" WHERE "ownerId" IS NULL;
SELECT COUNT(*) FROM "Template" WHERE "ownerId" IS NULL;
SELECT COUNT(*) FROM "User" WHERE "id" = '00000000-0000-0000-0000-000000000001' AND "isDisabled" = true;
SELECT column_default FROM information_schema.columns WHERE table_name = 'Document' AND column_name = 'ownerId';
SELECT column_default FROM information_schema.columns WHERE table_name = 'Template' AND column_name = 'ownerId';
SELECT column_default FROM information_schema.columns WHERE table_name = 'Template' AND column_name = 'status';
```

Expected values are `0`, `0`, `1`, system-owner defaults for both owner columns, and `REJECTED` for the template status default.

- [ ] **Step 2: Run against an empty disposable target and observe any migration failure**

Run: `pwsh -File ops/test-migrations.ps1`

The script creates uniquely named container/volume resources, waits for PostgreSQL readiness, sets a target-only `DATABASE_URL`, runs `npm run prisma:deploy:fresh`, invokes the integrity assertion, and removes only its uniquely named resources in `finally` after resolving their names. Expected before fixes: FAIL on migration drift/destructive SQL.

- [ ] **Step 3: Make native process failures fatal and rerun**

Every native command is invoked through a helper that checks `$LASTEXITCODE`:

```powershell
function Invoke-Native([string]$File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$File failed with exit code $LASTEXITCODE" }
}
```

Run Step 2 again.

Expected: migrations deploy to empty PostgreSQL, ownership assertions pass, and cleanup touches only rehearsal resources.

- [ ] **Step 4: Run the Phase 1 suite**

Run: `cd backend && npm test -- --runInBand && npx prisma validate && npm run build`; then `docker compose config --quiet`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ops/test-migrations.ps1 backend/scripts/assert_owner_integrity.ts backend/package.json
git commit -m "test: rehearse migrations and ownership integrity"
```
