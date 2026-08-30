# Hard Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the hard half of the approved comprehensive remediation: safe existing-volume migration, streamed conversion transport, strict Redis worker recovery, lossless conversion fidelity, all frontend changes, cross-stack enforcement, and final runtime verification.

**Architecture:** Keep Prisma, PostgreSQL, Redis, FastAPI, Express, and Next.js as the existing service boundaries. Add focused pure helpers for schema compatibility, Redis failure semantics, geometry-based fidelity, registration configuration, and source-preview lifecycle; cover each boundary with a failing regression before changing production behavior. Integrate—but do not overwrite—the separately owned easy-track fixes.

**Tech Stack:** TypeScript, Node.js, Express, Axios, Prisma/PostgreSQL, React 19, Next.js 15, Vitest, Python 3.12, FastAPI, Redis, pytest, Docker Compose, PowerShell.

**Spec:** `docs/superpowers/specs/2026-08-28-comprehensive-review-remediation-design.md`

## Global Constraints

- Preserve every existing database and application-data volume; never drop, truncate, rewrite, or automatically recreate user tables.
- Allow unrelated legacy tables and nullable/defaulted extra columns; reject missing/incompatible current columns, missing current key relationships, and extra required columns without defaults.
- Keep the public bulk contract at ten files of 50 MB each and enforce a 500 MB aggregate limit.
- Use a 300-second submission timeout by default, clamp configuration to 600 seconds, and keep status/report reads on their existing short timeout.
- Workers use strict Redis semantics and exit non-zero on Redis faults while preserving the source file and processing-list entry for reclaim.
- Prefer document fidelity over cosmetic inference: preserve ambiguous lines and tables when continuation or repetition cannot be proven.
- Standalone password reset defaults to disabled; public registration requires Turnstile; frontend visibility and backend enforcement share one registration-mode value.
- The source action is labeled exactly `Xem PDF gốc`; create only one lazy preview object URL and revoke it on close, replacement, and unmount.
- Keep source remediation uncommitted. At each checkpoint inspect the working-tree diff; do not create source commits.
- Do not edit easy-track implementation files unless integration proves a concrete conflict. Easy-track ownership includes the root `.dockerignore`, conversion Dockerfile/context contract, FastAPI `_admit_upload` threading, Multer rejection normalization, Python typography guard internals, HTTPX compatibility, and backend-only development advisories.
- Do not add server-owned OCR credentials, reintroduce removed product surfaces, or redesign the established visual language.

## File Structure

- `backend/src/services/migration_baseline.ts`: pure schema-shape compatibility rules and diagnostic result type.
- `backend/src/scripts/detect_migration_baseline.ts`: read-only PostgreSQL/Prisma inspection CLI; stdout contains only the machine-readable state.
- `backend/src/services/conversion_service_client.ts`: disk-streamed multipart transport and bounded submission timeout.
- `conversion-service/job_store.py`: strict/non-strict Redis modes and the dedicated availability exception.
- `conversion-service/worker.py`: strict worker construction and preservation rules when Redis becomes unavailable.
- `conversion-service/schema/blocks.py`: optional normalized geometry carried by structured blocks.
- `conversion-service/structuring/classifier.py`: line-to-block geometry propagation.
- `conversion-service/structuring/admin_zones.py`: explicit recognized/consumed zone results.
- `conversion-service/pipeline.py`: lossless zone reinsertion and table-page parity.
- `conversion-service/postprocess.py`: margin-banded running-header removal and evidence-based split-table merging.
- `frontend/lib/server/public-registration-mode.ts`: one server-only parser for the shared registration switch.
- `frontend/lib/server/client-ip.ts`: direct-peer trusted-proxy selection.
- `frontend/app/api/ready/route.ts`: auth-configuration readiness gate.
- `frontend/app/(auth)/login/page.tsx` and `frontend/app/(auth)/signup/page.tsx`: registration-aware entry points.
- `frontend/components/auth/AuthForm.tsx`: conditional signup navigation.
- `frontend/components/auth/RegistrationUnavailable.tsx`: explicit disabled-registration state.
- `frontend/app/(app)/convert/page.tsx`: unified job mutation and single lazy source preview.
- `docker-compose.yml`, `.env.example`, `.github/workflows/ci.yml`, and `PRODUCT.md`: shared runtime contract, enforcement, and product-language updates.

---

### Task 1: Existing-Volume Migration Baseline

**Files:**
- Create: `backend/src/services/migration_baseline.ts`
- Create: `backend/src/services/migration_baseline.test.ts`
- Create: `backend/src/scripts/detect_migration_baseline.ts`
- Create: `backend/src/scripts/detect_migration_baseline.test.ts`
- Modify: `backend/package.json`
- Modify: `backend/tsconfig.json` only if the existing include excludes `src/scripts`
- Modify: `docker-compose.yml`
- Modify: `backend/src/index.worker_wiring.test.ts`
- Modify: `ops/test-compose.ps1`

**Interfaces:**
- Consumes: current Prisma migration `20260901000000_init_standalone_auth` and `DATABASE_URL`.
- Produces: `assessMigrationBaseline(snapshot: DatabaseShape): BaselineAssessment`, where `BaselineAssessment` is `{ state: "fresh" | "already-migrated" | "compatible" | "incompatible"; diagnostics: string[] }`.
- Produces: CLI stdout of exactly `fresh`, `already-migrated`, or `compatible`; incompatible shapes write actionable diagnostics to stderr and exit non-zero.

- [ ] **Step 1: Write pure compatibility regressions**

```ts
it("accepts a compatible legacy database with harmless extras", () => {
  const result = assessMigrationBaseline(compatibleShape({
    extraTables: ["legacy_audit"],
    extraColumns: [{ table: "User", name: "nickname", nullable: true, default: null }],
  }));
  expect(result).toEqual({ state: "compatible", diagnostics: [] });
});

it.each([
  ["missing column", compatibleShape({ removeColumn: ["Job", "ownerId"] })],
  ["blocking extra column", compatibleShape({ extraColumns: [{ table: "Job", name: "tenant", nullable: false, default: null }] })],
  ["missing foreign key", compatibleShape({ removeForeignKey: ["Job", "ownerId", "User", "id"] })],
])("rejects %s", (_label, shape) => {
  const result = assessMigrationBaseline(shape);
  expect(result.state).toBe("incompatible");
  expect(result.diagnostics.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the focused pure tests and confirm RED**

Run: `npm --prefix backend test -- --run src/services/migration_baseline.test.ts`

Expected: FAIL because `migration_baseline.ts` and `assessMigrationBaseline` do not exist.

- [ ] **Step 3: Implement exact shape and compatibility types**

```ts
export type ColumnShape = {
  table: string;
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
};
export type KeyShape = {
  kind: "PRIMARY KEY" | "UNIQUE" | "FOREIGN KEY" | "CHECK";
  table: string;
  columns: string[];
  referencedTable?: string;
  referencedColumns?: string[];
  definition?: string;
};
export type DatabaseShape = {
  tables: string[];
  columns: ColumnShape[];
  keys: KeyShape[];
  appliedMigrationNames: string[];
};
export type BaselineAssessment = {
  state: "fresh" | "already-migrated" | "compatible" | "incompatible";
  diagnostics: string[];
};
```

Encode the exact columns and relationships from the initial Prisma migration. Treat PostgreSQL aliases such as `character varying`/`varchar` and `timestamp without time zone`/`timestamp` as compatible only where the migration uses that family. Require the current Gemini-only provider check as well as current primary, unique, and foreign-key constraints. Return `fresh` only when none of `User`, `PasswordResetToken`, or `UserLLMConfig` exists; return `already-migrated` when the initial migration is recorded; otherwise require all three product tables to pass the compatibility checks.

- [ ] **Step 4: Run pure baseline tests and confirm GREEN**

Run: `npm --prefix backend test -- --run src/services/migration_baseline.test.ts`

Expected: PASS for fresh, already migrated, compatible legacy, missing column, incompatible type, missing primary/unique/foreign keys, harmless extras, and blocking extra columns.

- [ ] **Step 5: Write CLI query/output regressions**

```ts
it("prints only the compatible state to stdout", async () => {
  const io = fakeIo();
  const exitCode = await runBaselineDetector(fakeInspector(compatibleShape()), io);
  expect(exitCode).toBe(0);
  expect(io.stdout).toEqual(["compatible\n"]);
  expect(io.stderr).toEqual([]);
});

it("fails closed and sends details to stderr", async () => {
  const io = fakeIo();
  const exitCode = await runBaselineDetector(fakeInspector(incompatibleShape()), io);
  expect(exitCode).toBe(2);
  expect(io.stdout).toEqual([]);
  expect(io.stderr.join(" ")).toContain("Back up the database");
});
```

- [ ] **Step 6: Run CLI tests and confirm RED**

Run: `npm --prefix backend test -- --run src/scripts/detect_migration_baseline.test.ts`

Expected: FAIL because the detector entry point does not exist.

- [ ] **Step 7: Implement a read-only Prisma inspector and Compose gate**

The inspector uses `$queryRaw` against `information_schema.tables`, `information_schema.columns`, `information_schema.table_constraints`, `key_column_usage`, `constraint_column_usage`, and `_prisma_migrations` when present. Export `runBaselineDetector(inspector, io): Promise<number>` for tests; invoke it only under `if (require.main === module)`.

Use this Compose command shape:

```sh
baseline_state="$(node dist/scripts/detect_migration_baseline.js)" || exit $?
if [ "$baseline_state" = "compatible" ]; then
  npx prisma migrate resolve --applied 20260901000000_init_standalone_auth
fi
npx prisma migrate deploy
```

Update wiring tests to require the detector before deploy and to forbid `resolve` for `fresh`/`already-migrated` states.

- [ ] **Step 8: Verify migration build and contracts**

Run: `npm --prefix backend test -- --run src/services/migration_baseline.test.ts src/scripts/detect_migration_baseline.test.ts src/index.worker_wiring.test.ts`

Run: `npm --prefix backend run build`

Run: `powershell -ExecutionPolicy Bypass -File ops/test-compose.ps1`

Expected: all PASS; the compiled detector exists at `backend/dist/scripts/detect_migration_baseline.js`.

- [ ] **Step 9: Working-tree checkpoint**

Run: `git diff --check`

Run: `git diff -- backend/src/services/migration_baseline.ts backend/src/scripts/detect_migration_baseline.ts docker-compose.yml`

Expected: no whitespace errors; only read-only detection, conditional resolve, and deploy changes. Do not commit.

### Task 2: Streamed Multipart Submission and Bounded Timeout

**Files:**
- Modify: `backend/src/services/conversion_service_client.ts`
- Create: `backend/src/services/conversion_service_client.test.ts`
- Modify: `backend/package.json`
- Modify: `backend/package-lock.json`

**Interfaces:**
- Consumes: staging file paths already owned and cleaned by route handlers.
- Produces: `getSubmissionTimeoutMs(raw = process.env.CONVERSION_SUBMIT_TIMEOUT_MS): number`, default `300_000`, minimum one second, maximum `600_000`.
- Produces: multipart requests whose file bodies are `fs.createReadStream(path)` values; status/report methods keep their existing timeout constant.

- [ ] **Step 1: Write timeout and streaming regressions**

```ts
it.each([
  [undefined, 300_000],
  ["450000", 450_000],
  ["900000", 600_000],
  ["not-a-number", 300_000],
])("normalizes %s to %d", (raw, expected) => {
  expect(getSubmissionTimeoutMs(raw)).toBe(expected);
});

it("streams bulk files and enforces 500 MB before transport", async () => {
  const transport = fakeAxios();
  const stat = vi.fn().mockResolvedValue({ size: 50 * 1024 * 1024 });
  await submitBulk(files(10), { transport, stat, createReadStream });
  expect(transport.post).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ getHeaders: expect.any(Function) }),
    expect.objectContaining({ timeout: 300_000 }),
  );
  expect(createReadStream).toHaveBeenCalledTimes(10);
});
```

Also assert eleven files fail, any individual file above 50 MB fails, aggregate bytes above 500 MB fail before `post`, and no test path calls `readFile`.

- [ ] **Step 2: Run client tests and confirm RED**

Run: `npm --prefix backend test -- --run src/services/conversion_service_client.test.ts`

Expected: FAIL because the current client reads Buffers and uses a 30-second submission timeout.

- [ ] **Step 3: Add the Node multipart dependency and stream adapter**

Use the maintained `form-data` package as a direct runtime dependency. Append each file with a stream and metadata:

```ts
const form = new FormData();
form.append("files", createReadStream(file.path), {
  filename: file.originalname,
  contentType: file.mimetype,
  knownLength: file.size,
});
await axios.post(url, form, {
  headers: form.getHeaders(),
  maxBodyLength: 500 * 1024 * 1024,
  timeout: getSubmissionTimeoutMs(),
});
```

Validate counts and bytes before creating streams. Use the same streaming helper for single-file submission. Do not change staging cleanup ownership in the routes.

- [ ] **Step 4: Run focused client and route tests**

Run: `npm --prefix backend test -- --run src/services/conversion_service_client.test.ts src/routes/jobs.test.ts`

Expected: PASS; single and bulk submission contracts remain stable.

- [ ] **Step 5: Verify compile and production dependency audit**

Run: `npm --prefix backend run build`

Run: `npm --prefix backend audit --omit=dev`

Expected: build succeeds and production audit has no high-severity findings.

- [ ] **Step 6: Working-tree checkpoint**

Run: `git diff --check`

Run: `git diff --stat -- backend/src/services/conversion_service_client.ts backend/package.json backend/package-lock.json`

Expected: only streaming transport, timeout normalization, tests, and required lockfile changes. Do not commit.

### Task 3: Strict Redis Worker Recovery

**Files:**
- Modify: `conversion-service/job_store.py`
- Modify: `conversion-service/worker.py`
- Modify: `conversion-service/tests/test_queue_durability.py`
- Modify: `conversion-service/tests/test_quota_refund_on_failure.py`
- Create: `conversion-service/tests/test_worker_redis_failure.py`

**Interfaces:**
- Produces: `class RedisUnavailableError(RuntimeError)`.
- Produces: `JobStore(strict_redis: bool = False)`; strict mode never reads or writes memory fallback.
- Produces: one bounded Redis reconnect/retry in non-strict mode before development fallback.
- Worker contract: any `RedisUnavailableError` exits the process non-zero and leaves source plus processing-list membership untouched.

- [ ] **Step 1: Write strict-store failure regressions**

```python
def test_strict_store_raises_instead_of_falling_back(fake_redis):
    fake_redis.hget.side_effect = RedisError("offline")
    store = JobStore(redis_client=fake_redis, strict_redis=True)
    with pytest.raises(RedisUnavailableError, match="Redis unavailable during load"):
        store.load("job-1")
    assert store._memory == {}

def test_api_store_reconnects_once_before_memory_fallback(redis_factory):
    redis_factory.side_effect = [broken_client(), healthy_client(job={"id": "job-1"})]
    store = JobStore(redis_factory=redis_factory, strict_redis=False)
    assert store.load("job-1")["id"] == "job-1"
    assert redis_factory.call_count == 2
```

- [ ] **Step 2: Run store tests and confirm RED**

Run: `python -m pytest conversion-service/tests/test_queue_durability.py -q`

Expected: FAIL because strict mode and `RedisUnavailableError` do not exist.

- [ ] **Step 3: Implement dedicated availability semantics**

Centralize Redis operations through a helper shaped like:

```python
def _redis_call(self, operation: str, call: Callable[[], T]) -> T:
    try:
        return call()
    except RedisError as first_error:
        if self.strict_redis:
            raise RedisUnavailableError(f"Redis unavailable during {operation}") from first_error
        if self._reconnect_once():
            try:
                return call()
            except RedisError:
                pass
        self._redis = None
        raise _UseDevelopmentFallback(operation)
```

All strict load, save/update, dequeue/claim, processing cleanup, and queue cleanup paths use this helper. Non-strict fallback loops retain a delay and never spin on a disconnected client.

- [ ] **Step 4: Run store durability tests and confirm GREEN**

Run: `python -m pytest conversion-service/tests/test_queue_durability.py -q`

Expected: PASS for strict failure, bounded reconnect, fallback behavior, processing reclaim, and idle delay.

- [ ] **Step 5: Write worker preservation and exit regressions**

```python
def test_process_job_preserves_reclaim_state_on_redis_failure(tmp_path, strict_store):
    source = tmp_path / "source.pdf"
    source.write_bytes(b"pdf")
    strict_store.update.side_effect = RedisUnavailableError("Redis unavailable during save")
    with pytest.raises(RedisUnavailableError):
        process_job("job-1", store=strict_store)
    assert source.exists()
    strict_store.remove_processing.assert_not_called()

def test_worker_main_returns_nonzero_with_actionable_message(capsys, strict_store):
    strict_store.dequeue.side_effect = RedisUnavailableError("Redis unavailable during dequeue")
    assert worker_main(store_factory=lambda: strict_store) == 1
    assert "Redis" in capsys.readouterr().err
```

- [ ] **Step 6: Run worker tests and confirm RED**

Run: `python -m pytest conversion-service/tests/test_worker_redis_failure.py conversion-service/tests/test_quota_refund_on_failure.py -q`

Expected: FAIL because the worker currently catches generic errors and cleans terminal artifacts.

- [ ] **Step 7: Make the worker strict and preserve reclaimable state**

Construct `JobStore(strict_redis=True)` in worker entrypoints. Catch `RedisUnavailableError` before the generic job-failure path, log the operation and job identifier, skip source/artifact removal and processing-list removal, then re-raise to `worker_main`, which returns `1`. Continue normal quota refund and cleanup for conversion failures where Redis remains healthy.

- [ ] **Step 8: Run all Redis/refund tests and compile Python**

Run: `python -m pytest conversion-service/tests/test_queue_durability.py conversion-service/tests/test_worker_redis_failure.py conversion-service/tests/test_quota_refund_on_failure.py -q`

Run: `python -m compileall -q conversion-service`

Expected: PASS; Redis faults differ from ordinary conversion failures and Python compiles cleanly.

- [ ] **Step 9: Working-tree checkpoint**

Run: `git diff --check`

Run: `git diff -- conversion-service/job_store.py conversion-service/worker.py`

Expected: no strict-worker fallback or Redis-failure cleanup remains. Do not commit.

### Task 4: Lossless Zones, Geometric Running Headers, and Table Continuation

**Files:**
- Modify: `conversion-service/schema/blocks.py`
- Modify: `conversion-service/structuring/models.py` or the file defining `LineInfo`
- Modify: `conversion-service/structuring/classifier.py`
- Modify: `conversion-service/structuring/admin_zones.py`
- Modify: `conversion-service/pipeline.py`
- Modify: `conversion-service/postprocess.py`
- Modify: existing structuring/postprocess tests identified by `rg "running_headers|split_tables|admin_zones|partition_zones" conversion-service/tests`
- Create: `conversion-service/tests/test_fidelity_regressions.py`

**Interfaces:**
- Produces: optional normalized `bbox: BBox | None` on structured blocks, using the existing 0–1000 coordinate system.
- Produces: `ZoneBuildResult[T]` with `block: T | None` and `consumed_line_ids: frozenset[str]` (use the actual stable line identifier already present; if absent, add a deterministic `(page, source_index)` key).
- Produces: `restore_unconsumed_zones(zones, header_result, signature_result): list[LineInfo]`, sorted by page, vertical position, then horizontal position.

- [ ] **Step 1: Write lossless-zone regressions**

```python
def test_page_two_top_zone_returns_to_body():
    doc = structure_pages([page_one(), page_two(top="Điều 2. Hiệu lực")])
    assert "Điều 2. Hiệu lực" in all_text(doc)

def test_unrecognized_bottom_zone_returns_to_body():
    doc = structure_pages([page_one(bottom="Nơi thi hành nhận bản sao")])
    assert "Nơi thi hành nhận bản sao" in all_text(doc)

def test_recognized_page_one_header_is_not_duplicated():
    doc = structure_pages([page_one(admin_header=valid_header())])
    assert all_text(doc).count("BỘ TƯ PHÁP") == 1
```

- [ ] **Step 2: Run zone regressions and confirm RED**

Run: `python -m pytest conversion-service/tests/test_fidelity_regressions.py -k "zone or header" -q`

Expected: FAIL because current pipelines classify only `zones.body`.

- [ ] **Step 3: Carry geometry and explicit consumption through classification**

Add page width/height to `LineInfo` and normalize its union box:

```python
def normalized_bbox(line: LineInfo) -> BBox:
    return BBox(
        x0=round(1000 * line.x0 / line.page_width),
        y0=round(1000 * line.y / line.page_height),
        x1=round(1000 * line.x1 / line.page_width),
        y1=round(1000 * line.y1 / line.page_height),
    )
```

Attach a union bbox to paragraphs/list blocks and normalized extraction geometry to tables. Make header/signature builders return the exact consumed keys. For page one, reclassify unconsumed top and bottom lines; for later pages, reclassify all top and unconsumed bottom lines. Apply identical behavior to digital and table-heavy branches while retaining the existing accepted-table bbox filter to prevent text duplication.

- [ ] **Step 4: Run zone/classifier tests and confirm GREEN**

Run: `python -m pytest conversion-service/tests/test_fidelity_regressions.py -k "zone or header" conversion-service/tests/test_structuring.py -q`

Expected: PASS with no duplicate accepted-table text.

- [ ] **Step 5: Write running-header and split-table regressions**

```python
def test_repeated_body_clause_is_preserved():
    blocks = [paragraph("Điều khoản chung", page=1, bbox=box(100, 420, 900, 470)),
              paragraph("Điều khoản chung", page=2, bbox=box(100, 420, 900, 470))]
    assert strip_running_headers(blocks) == blocks

def test_true_top_margin_header_is_removed():
    blocks = [paragraph("CÔNG BÁO", page=1, bbox=box(100, 20, 900, 70)),
              paragraph("CÔNG BÁO", page=2, bbox=box(100, 18, 900, 68))]
    assert strip_running_headers(blocks) == []

def test_independent_same_width_tables_do_not_merge():
    first = table(page=1, headers=["Mã", "Tên"], bbox=box(50, 200, 950, 600))
    second = table(page=2, headers=["Mã", "Tên"], bbox=box(50, 250, 950, 650))
    assert merge_split_tables([first, second]) == [first, second]
```

Also cover a true continuation with matching headers at bottom/top boundaries, a continuation whose second page omits headers, mismatched headers, and absent geometry.

- [ ] **Step 6: Run postprocess regressions and confirm RED**

Run: `python -m pytest conversion-service/tests/test_fidelity_regressions.py -k "running or table" -q`

Expected: FAIL because current logic ignores geometry and merges on column count alone.

- [ ] **Step 7: Implement geometric evidence rules**

Running-header removal requires normalized repeated text on at least two pages and the same band: top when `bbox.y1 <= 120`, bottom when `bbox.y0 >= 880`. Blocks without geometry remain untouched.

Table merge requires consecutive pages, equal column count, and boundary evidence `previous.bbox.y1 >= 850` plus `next.bbox.y0 <= 150`. If both tables expose non-empty headers, compare normalized cell text and require equality. If the continuation omits headers, retain the first header and append all next rows. If geometry is absent or evidence fails, retain both tables.

- [ ] **Step 8: Run fidelity and rendering gates**

Run: `python -m pytest conversion-service/tests/test_fidelity_regressions.py conversion-service/tests -q`

Run the repository's P0a rendering command located with `rg "P0a|rendering gate" README.md docs ops conversion-service`.

Expected: all conversion tests and the document-rendering gate pass.

- [ ] **Step 9: Working-tree checkpoint**

Run: `git diff --check`

Run: `git diff --stat -- conversion-service/schema conversion-service/structuring conversion-service/pipeline.py conversion-service/postprocess.py`

Expected: geometry and consumption are additive; ambiguous content is retained. Do not commit.

### Task 5: Frontend Registration, Readiness, and Trusted Proxy Security

**Files:**
- Create: `frontend/lib/server/public-registration-mode.ts`
- Create: `frontend/lib/server/public-registration-mode.test.ts`
- Modify: `frontend/lib/server/client-ip.ts`
- Modify: its existing test file found with `rg "getClientIp|trusted proxy" frontend/test frontend/lib`
- Modify: `frontend/app/api/ready/route.ts`
- Modify: its existing readiness test or create `frontend/test/readiness.test.ts`
- Modify: `frontend/app/(auth)/login/page.tsx`
- Modify: `frontend/app/(auth)/signup/page.tsx`
- Modify: `frontend/components/auth/AuthForm.tsx`
- Create: `frontend/components/auth/RegistrationUnavailable.tsx`
- Create: `frontend/test/registration-mode.test.tsx`
- Modify: `docker-compose.yml`
- Modify: `.env.example`

**Interfaces:**
- Produces: `isPublicRegistrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean`; only case-insensitive `true`, `1`, and `yes` disable registration through `DISABLE_PUBLIC_REGISTER`, matching backend semantics.
- Produces: readiness JSON with `status: "ready"` only when backend readiness passes, password reset configuration is valid, and enabled registration has a non-empty Turnstile site key.
- Produces: direct-peer client selection: remove `FRONTEND_TRUST_PROXY_HOPS` addresses from the right edge and select the new rightmost value.

- [ ] **Step 1: Read the frontend design and implementation skills before changing UI**

Read `C:/Users/PC/.agents/skills/impeccable/SKILL.md` completely and follow its routed accessibility/responsive references. Read `C:/Users/PC/.codex/plugins/cache/claude-plugins-official/chrome-devtools-mcp/1.7.0/skills/a11y-debugging/SKILL.md` before browser verification. Record any skill-driven constraint in the working notes.

- [ ] **Step 2: Write registration and readiness regressions**

```ts
it.each([
  [{}, true],
  [{ DISABLE_PUBLIC_REGISTER: "true" }, false],
  [{ DISABLE_PUBLIC_REGISTER: "1" }, false],
])("parses shared registration mode", (env, expected) => {
  expect(isPublicRegistrationEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
});

it("is not ready when registration lacks Turnstile", async () => {
  process.env.DISABLE_PUBLIC_REGISTER = "false";
  delete process.env.TURNSTILE_SITE_KEY;
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ status: "not_ready" });
});
```

Render `/signup` logic with registration disabled and assert the unavailable state is present and no signup form appears. Render login with the same mode and assert no `/signup` link exists.

- [ ] **Step 3: Run registration/readiness tests and confirm RED**

Run: `npm --prefix frontend test -- --run test/registration-mode.test.tsx test/readiness.test.ts lib/server/public-registration-mode.test.ts`

Expected: FAIL because the shared parser and unavailable state do not exist.

- [ ] **Step 4: Implement server-only configuration and auth entry points**

Use the parser in both auth pages and readiness. Pass `publicRegistrationEnabled` into `AuthForm`; render the signup link only when true. `/signup` renders `RegistrationUnavailable` when false. Keep the backend authoritative; this task does not weaken its existing HTTP 403.

Map these Compose values explicitly:

```yaml
PASSWORD_RESET_MODE: ${PASSWORD_RESET_MODE:-disabled}
TURNSTILE_SITE_KEY: ${TURNSTILE_SITE_KEY:-}
FRONTEND_TRUST_PROXY_HOPS: ${FRONTEND_TRUST_PROXY_HOPS:-0}
DISABLE_PUBLIC_REGISTER: ${DISABLE_PUBLIC_REGISTER:-false}
```

Document identical defaults in `.env.example`.

- [ ] **Step 5: Run auth and readiness tests and confirm GREEN**

Run: `npm --prefix frontend test -- --run test/registration-mode.test.tsx test/readiness.test.ts lib/server/public-registration-mode.test.ts`

Expected: PASS for enabled/disabled registration, missing Turnstile, disabled password reset, and healthy backend readiness.

- [ ] **Step 6: Write direct-peer proxy regressions**

```ts
it("selects the client appended by one trusted proxy", () => {
  expect(getClientIp(request("198.51.100.7"), { trustedProxyHops: 1, remoteAddress: "10.0.0.4" }))
    .toBe("198.51.100.7");
});

it("ignores a spoofed prefix appended before the real client", () => {
  expect(getClientIp(request("203.0.113.99, 198.51.100.7"), { trustedProxyHops: 1, remoteAddress: "10.0.0.4" }))
    .toBe("198.51.100.7");
});
```

- [ ] **Step 7: Run proxy tests, implement right-edge removal, and rerun**

Run the discovered proxy test file; confirm the spoofed-prefix case fails. Build the chain as forwarded addresses followed by the direct peer, remove exactly the trusted right-edge peer count, then select the new rightmost address; when configured hops exceed the chain, fail to the direct peer rather than trusting the left edge. Rerun and expect PASS.

- [ ] **Step 8: Build and checkpoint**

Run: `npm --prefix frontend run build`

Run: `git diff --check`

Expected: production build succeeds; configuration and backend behavior use the same registration flag. Do not commit.

### Task 6: Unified Conversion State and Single Lazy PDF Preview

**Files:**
- Modify: `frontend/app/(app)/convert/page.tsx`
- Modify: `frontend/test/convert-polling.test.tsx`
- Create: `frontend/test/convert-preview.test.tsx`

**Interfaces:**
- Job state stores `sourceFile: File | null`, not a long-lived object URL.
- Produces: `updateJob(jobId: string, update: Partial<ConversionJob> | ((current: ConversionJob) => ConversionJob)): void`; every mutation updates state and `jobsRef` from one computed next array.
- Preview state is exactly `{ jobId: string; url: string } | null`; replacement and close revoke the current URL before changing state.

- [ ] **Step 1: Write concurrency and lazy-preview regressions**

```tsx
it("keeps a report open across a polling update", async () => {
  render(<ConvertPage />);
  await seedCompletedJob();
  await user.click(screen.getByRole("button", { name: /xem báo cáo/i }));
  resolveNextPoll({ status: "done", progress: 100 });
  expect(await screen.findByText(/độ tin cậy/i)).toBeVisible();
});

it("creates only one lazy source URL and revokes replacements", async () => {
  render(<ConvertPage />);
  await seedCompletedJobs(2);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  await user.click(screen.getAllByRole("button", { name: "Xem PDF gốc" })[0]);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(screen.getAllByTitle(/pdf gốc/i)).toHaveLength(1);
  await user.click(screen.getAllByRole("button", { name: "Xem PDF gốc" })[1]);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:first");
  expect(screen.getAllByTitle(/pdf gốc/i)).toHaveLength(1);
});
```

Also assert close revokes immediately and unmount revokes the final URL.

- [ ] **Step 2: Run conversion frontend tests and confirm RED**

Run: `npm --prefix frontend test -- --run test/convert-polling.test.tsx test/convert-preview.test.tsx`

Expected: FAIL because report toggle bypasses the shared ref update and completed jobs eagerly mount multiple iframes.

- [ ] **Step 3: Implement one mutation path and lazy preview state**

Use a functional state update:

```ts
const updateJob = useCallback((jobId: string, update: JobUpdate) => {
  setJobs((currentJobs) => {
    const nextJobs = currentJobs.map((job) => {
      if (job.id !== jobId) return job;
      return typeof update === "function" ? update(job) : { ...job, ...update };
    });
    jobsRef.current = nextJobs;
    return nextJobs;
  });
}, []);
```

Store the original `File` only as long as the UI needs it. `openPreview(job)` revokes a previous URL, creates one URL from `job.sourceFile`, and sets the new preview. `closePreview()` revokes then clears. Use one preview panel outside the job loop and one iframe. Every status, progress, result, error, and report-toggle change goes through `updateJob`.

- [ ] **Step 4: Run conversion frontend tests and confirm GREEN**

Run: `npm --prefix frontend test -- --run test/convert-polling.test.tsx test/convert-preview.test.tsx`

Expected: PASS; polling cannot revert report state and object URL lifecycle is exact.

- [ ] **Step 5: Run the complete frontend unit suite**

Run: `npm --prefix frontend test -- --run`

Expected: all frontend tests pass without object-URL leaks or act warnings introduced by this task.

- [ ] **Step 6: Working-tree checkpoint**

Run: `git diff --check`

Run: `git diff -- frontend/app/(app)/convert/page.tsx frontend/test/convert-polling.test.tsx frontend/test/convert-preview.test.tsx`

Expected: at most one iframe is rendered and every mutation uses `updateJob`. Do not commit.

### Task 7: Frontend Product Truth, Touch Targets, CI, and Development Audits

**Files:**
- Modify: `frontend/components/ui/button.tsx`
- Modify: `frontend/app/(auth)/layout.tsx`
- Modify: `frontend/app/layout.tsx`
- Modify: `frontend/app/page.tsx` only where stale product claims remain
- Modify: `frontend/test/design-system.test.ts`
- Modify: `frontend/test/landing-page.test.tsx`
- Modify: `PRODUCT.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Integrate: separately owned Python typography guard and backend dev-audit changes after inspecting their diff

**Interfaces:**
- The icon-only button variant has a rendered minimum target of 44 by 44 CSS pixels.
- CI runs typography preflight/release preflight, production audits, and full development audits as separate named gates.
- Copy mentions only authenticated PDF-to-DOCX conversion, confidence review, and Decree-30 output.

- [ ] **Step 1: Write target-size and truthful-copy regressions**

```ts
it("keeps icon buttons at least 44px square", () => {
  expect(buttonVariants({ variant: "icon", size: "sm" })).toMatch(/min-h-11/);
  expect(buttonVariants({ variant: "icon", size: "sm" })).toMatch(/min-w-11/);
});

it("does not advertise removed product surfaces", () => {
  render(<LandingPage />);
  expect(screen.queryByText(/chat|rag|template library|drafting assistant/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run design/copy tests and confirm RED**

Run: `npm --prefix frontend test -- --run test/design-system.test.ts test/landing-page.test.tsx`

Expected: FAIL for the 40-pixel icon target or stale product claims.

- [ ] **Step 3: Apply scoped UI and documentation changes**

Set the icon target classes to `min-h-11 min-w-11 h-11 w-11` without changing visual colors or component hierarchy. Remove stale generation/drafting claims from auth and metadata copy. Update `PRODUCT.md` from the deprecated `Register` framing to current product-context headings while preserving the same conversion boundary and constraints.

- [ ] **Step 4: Run focused frontend tests, lint, and build**

Run: `npm --prefix frontend test -- --run test/design-system.test.ts test/landing-page.test.tsx`

Run: `npm --prefix frontend run lint`

Run: `npm --prefix frontend run build`

Expected: tests, lint, and production build pass.

- [ ] **Step 5: Add separate CI enforcement gates**

The workflow must contain explicit commands equivalent to:

```yaml
- name: Verify typography sync
  run: python scripts/check_typography_sync.py
- name: Run release preflight
  run: python scripts/release_preflight.py
- name: Audit backend production dependencies
  run: npm --prefix backend audit --omit=dev --audit-level=high
- name: Audit backend development dependencies
  run: npm --prefix backend audit --audit-level=high
- name: Audit frontend production dependencies
  run: npm --prefix frontend audit --omit=dev --audit-level=high
- name: Audit frontend development dependencies
  run: npm --prefix frontend audit --audit-level=high
```

Use the repository's actual script paths/options discovered by reading those scripts. Do not duplicate a command already enforced by an existing job.

- [ ] **Step 6: Update only frontend development tooling required by full audit**

Run: `npm --prefix frontend audit --json`

For each high-severity development-only path, update the narrowest direct dev dependency that removes it. Production major upgrades remain prohibited unless a production advisory requires one. Preserve intentional TypeScript configuration and rerun focused tests after each lockfile change.

- [ ] **Step 7: Verify all dependency and preflight gates**

Run: `npm --prefix backend audit --omit=dev --audit-level=high`

Run: `npm --prefix backend audit --audit-level=high`

Run: `npm --prefix frontend audit --omit=dev --audit-level=high`

Run: `npm --prefix frontend audit --audit-level=high`

Run the exact typography guard and release preflight commands referenced by CI.

Expected: all commands return zero and do not suppress high-severity advisories.

- [ ] **Step 8: Working-tree checkpoint**

Run: `git diff --check`

Run: `git diff -- .github/workflows/ci.yml PRODUCT.md frontend/components/ui/button.tsx frontend/package.json frontend/package-lock.json`

Expected: enforcement is explicit, copy is truthful, and production dependency majors are unchanged unless justified by a production advisory. Do not commit.

### Task 8: Full Integration, Containers, Existing Volumes, Runtime Smoke, and Accessibility

**Files:**
- Modify only defects exposed by verification, preserving task ownership and adding a regression beside each repair
- Create: `docs/verification/2026-08-28-hard-remediation.md`

**Interfaces:**
- Consumes: completed hard tasks plus the separately implemented easy-track changes.
- Produces: an evidence log with command, timestamp, exit status, image IDs, volume safety statement, smoke results, accessibility results, credential-dependent exclusions, and remaining warnings.

- [ ] **Step 1: Reconcile concurrent easy-track changes before integration**

Run: `git status --short`

Run: `git diff --name-only`

Inspect any overlap before editing. Preserve the easy agent's `.dockerignore`, Dockerfile/context test, FastAPI admission, Multer normalization, typography guard internals, HTTPX compatibility, and backend dev-audit work when their focused tests pass.

- [ ] **Step 2: Run static and automated verification**

Run the repository test scripts discovered from root/backend/frontend package manifests plus:

```powershell
npm --prefix backend test -- --run
npm --prefix backend run build
npx --prefix backend prisma validate --schema backend/prisma/schema.prisma
npm --prefix frontend test -- --run
npm --prefix frontend run lint
npm --prefix frontend run build
python -m pytest conversion-service/tests -q
python -m compileall -q conversion-service
powershell -ExecutionPolicy Bypass -File ops/test-compose.ps1
```

Run typography preflight, release preflight, and the P0a document-rendering gate with their repository-defined commands. Record exact output summaries.

- [ ] **Step 3: Run security advisory scans**

Run production and full npm audits for backend and frontend. Run the repository's Python advisory scanner if configured; otherwise use the existing lock/requirements-compatible scanner installed by project tooling. Record scanner version and any credential/network limitation rather than silently skipping it.

- [ ] **Step 4: Record the old conversion image identity and build all images**

Start Docker Desktop if required. Before rebuilding, run:

```powershell
docker image inspect standalone/conversion:latest --format '{{.Id}}' 2>$null
docker image ls --filter dangling=true --format '{{.ID}} {{.CreatedAt}} {{.Size}}'
docker compose build conversion backend frontend
```

Record the old image ID and pre-existing dangling image list. Do not remove anything yet.

- [ ] **Step 5: Inspect the fixed conversion image before cleanup**

Run a disposable container and assert:

```sh
test ! -e /app/.venv
test ! -e /app/work || test -z "$(find /app/work -mindepth 1 -print -quit)"
! find /app -type f \( -iname '*.pdf' -o -iname '*.docx' \) -print -quit | grep .
```

Also inspect image history and copied paths. The check passes only if no work documents, local virtual environment, test outputs, or repository metadata are present.

- [ ] **Step 6: Verify fresh and compatible existing-volume migration boots**

Create uniquely named disposable Compose projects, never the user's project volumes. For the fresh case, start PostgreSQL, run `migrate`, and assert the initial migration is applied. For the compatible case, create the exact compatible three-table shape without `_prisma_migrations`, insert sentinel user/job/settings rows, run `migrate`, and assert:

```sql
SELECT COUNT(*) FROM "User" WHERE id = 'sentinel-user';
SELECT migration_name, finished_at IS NOT NULL
FROM "_prisma_migrations"
WHERE migration_name = '20260901000000_init_standalone_auth';
```

Both assertions must succeed. Tear down only the two explicitly named disposable projects and their volumes after resolving their absolute/project identities. Never pass `-v` to the user's ordinary project.

- [ ] **Step 7: Run live runtime smoke tests**

Boot the isolated stack and verify liveness/readiness, login, disabled-registration `/signup`, enabled-registration-without-Turnstile readiness rejection, wrong-MIME HTTP 400, oversized HTTP 413, queued digital PDF conversion, polling to terminal status, report fetch, and result download. Use generated non-sensitive PDFs in a validated temporary directory; remove that directory after verification.

- [ ] **Step 8: Run desktop/mobile accessibility checks**

Using the Chrome DevTools accessibility skill, inspect login, signup-unavailable, conversion jobs, report toggle, `Xem PDF gốc`, preview close, and theme toggle at desktop and mobile widths. Verify semantic names, keyboard focus order, visible focus, contrast, 44-pixel targets, one preview iframe, and no blocking console errors. Save screenshots only when they demonstrate an issue or final state.

- [ ] **Step 9: Remove only the verified old sensitive image identity**

After Steps 4–8 pass, confirm the recorded old image ID is no longer referenced by any tag or container. Remove exactly that ID with `docker image rm <recorded-old-id>` when Docker confirms it is dangling. Compare dangling lists and remove only layers/images whose ancestry can be tied to that recorded image. If Docker cannot attribute a build-cache record safely, leave it and report it; never run a broad image, builder, system, or volume prune.

- [ ] **Step 10: Write the verification record and final diff audit**

Record results in `docs/verification/2026-08-28-hard-remediation.md`, explicitly noting that real Gemini OCR and production SMTP delivery remain credential-dependent manual gates. Then run:

```powershell
git diff --check
git status --short
git diff --stat
```

Inspect every changed file, ensure no secret or generated artifact entered the tree, and leave all source remediation uncommitted.
