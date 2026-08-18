# Project Hardening Design

## Objective

Resolve every verified codebase-review finding while simplifying the product to user-owned workflows only. Replace the hard-coded generated DOCX examples with private, database-backed user templates that preserve the uploaded document's real Word layout, including floating text boxes. Make template ingestion, automatic semantic mapping, generation, rendering, and fidelity verification safe and migration-compatible. Remove administrator/reviewer product features, global feedback review, LoRA training management, model activation, and all admin routes without touching the live database or performing the production cutover.

## Constraints

- Preserve all existing user work in the dirty working tree.
- Do not restart the live backend or mutate the live PostgreSQL volume.
- Keep documents, templates, feedback, and provider settings private to their owning user. No interactive account receives cross-user access.
- Keep the deterministic disabled `system-owner` and the legacy-import ownership default.
- Use additive or staged migrations; do not drop populated legacy columns in the same migration that introduces replacement fields.
- Keep template files local to the deployment, using one shared Docker volume rather than adding object-storage infrastructure.
- Treat the user's original DOCX as the immutable rendering shell. Do not reconstruct accepted templates with `python-docx` or generate replacement layouts from document-type presets.
- Automatic placement means no mandatory human inspection for high-confidence templates; the software must still inspect DOCX structure and rendered pages. Ambiguous or unsupported templates are not silently accepted.
- High-fidelity server rendering uses a licensed, unattended-safe document engine. Microsoft Word COM automation will not run in the server or Docker stack.
- Add regression tests before behavioral fixes.

## Architecture

### 1. Database and cutover safety

Restore published migration files to their committed bytes. The published `20250608000000_rename_ollama_to_lmstudio` migration predates the migration that creates `ModelVersion`, so a verified empty target uses a guarded Prisma baseline step: prove that no application objects or `_prisma_migrations` table exist, mark only that pre-init migration as applied with `prisma migrate resolve`, and then run `prisma migrate deploy`; the helper refuses populated or ambiguous targets. Replace the generated destructive dynamic-template migration with staged migrations that first add nullable ownership, immutable-file, compilation-state, semantic-map, schema, confidence, compatibility, preview, and hash fields; seed or locate `system-owner`; backfill every existing template; and only then enforce required ownership and ready-state invariants. Retain legacy `header` and `signatureBlock` until a later explicitly scheduled cleanup, and remove the global `docType` uniqueness constraint without deleting rows. Keep `Document.ownerId`'s database default so data-only legacy imports receive the system owner.

Fresh migration deployment will create the pgvector extension before creating vector columns. Operational scripts will check every native command exit code, import in a single transaction, verify source/target primary-key sets and row counts with a documented exception for the seeded system owner, and fail on unvalidated foreign keys. The runbook will stop writers before the final backup, build the new backend first, and run migrations in a one-shot container with an explicit target URL.

### 2. User-only authentication and outbound-request security

The product will use one user session type. Admin/reviewer authentication middleware, routes, permissions, login UI, and token format will be removed. User tokens contain a signed `tokenUse: "user"` claim and no client-controlled role. Authentication loads the current database account so disabled or deleted accounts lose access immediately. The legacy `role` database column may remain temporarily for migration compatibility but is ignored by interactive authorization and is never used to grant cross-user access.

The frontend gains dedicated `/signup` (labeled **Create account**) and `/login` pages, logout, and session bootstrap. Create account collects the backend's required identity fields plus password and confirmation, validates them on both client and server, and reports duplicate-account and validation failures without leaking internal details. Login accepts the account identifier and password, preserves a safe same-origin return path, and redirects authenticated users into the application. Protected pages redirect anonymous visitors to login; auth pages redirect an already-authenticated user into the application. The Next.js proxy owns the browser session through an HttpOnly, Secure-in-production, SameSite cookie and forwards it as a Bearer token. Logout clears that cookie even if the backend session has already expired. Users can manage their encrypted API key, provider URL, and model selection from a dedicated settings page.

LLM provider URLs will be validated against an operator-configured local-provider host allowlist. Selecting `lmstudio` or `ollama` will not itself authorize arbitrary RFC1918 destinations. Stored URLs will be revalidated before use, redirects will remain disabled, and tests will cover loopback, RFC1918, IPv6, and metadata endpoints.

### 3. Database-backed templates

Every template has a mandatory `ownerId`. List/detail/upload/analyze/render/delete require an authenticated user and apply ownership inside the database query. Uploads enforce a bounded file size, DOCX magic/ZIP structure, normalized extension, safe generated filename, and a user-visible name. The service rejects encrypted documents, macro-enabled formats, external resource relationships, malformed packages, path traversal, decompression bombs, and unsupported embedded objects. Database writes and file cleanup are coordinated so failures do not leave orphan files. A user may keep multiple templates for the same document kind; `docType` is classification metadata, not a uniqueness boundary.

The template record stores the immutable original path and hash, compilation status, detected document kind, semantic field map, generation JSON Schema, analysis confidence, renderer compatibility report, preview metadata, and timestamps. Compilation states are `UPLOADED`, `ANALYZING`, `NEEDS_REVIEW`, `READY`, `REJECTED`, and `FAILED`. Generation is allowed only from `READY` templates whose stored hash still matches the original file. Existing template rows are assigned to `system-owner` during migration and retained for audit, but the generated files currently under `templates/` are retired from the product workflow and are not exposed as user defaults.

Backend and document-renderer containers mount the same named volume at one absolute path configured through `TEMPLATE_STORAGE_DIR`. Only the backend resolves a user-owned template identifier to a stored relative path. The renderer receives an internal opaque job containing that path, resolves it beneath the configured root, and rejects absolute paths, traversal, symlink escapes, hash mismatches, and calls without service authentication. The backend API returns one typed `{ success, templates }` contract that the frontend consumes through `/api/proxy/templates`.

#### 3.1 Automatic semantic template compilation

Compilation combines structural and visual analysis instead of asking an LLM to infer placement from raw text. A dedicated .NET document-renderer service uses the Open XML SDK to enumerate all editable Word stories and objects: body paragraphs, tables and cells, headers, footers, footnotes, fields, drawings, VML/DrawingML shapes, floating text boxes, content controls, bookmarks, and relationships. Every candidate receives a stable structural locator. For floating shapes the locator captures the anchor range, relative positioning, top/left/width/height, wrapping mode, z-order, rotation, text-frame margins, alignment, auto-size behavior, linked-frame chain, and inherited run/paragraph styles.

The renderer produces page images from the untouched original and a second set of analysis images with candidate regions labeled by stable IDs. A vision-capable model receives only those labeled images plus sanitized extracted text and maps semantic roles such as issuing agency, document number, place, date, recipient, subject, legal bases, repeatable body sections, distribution list, signatory title, and signatory name to structural locators. Deterministic Vietnamese label heuristics and structural evidence are combined with the model result. The stored map includes per-field confidence, expected cardinality, data type, formatting policy, and overflow policy.

Templates whose required fields are unambiguous and whose baseline rendering passes become `READY` without human inspection. Low-confidence mappings become `NEEDS_REVIEW` and are shown in a one-time visual confirmation interface; unsupported structures become `REJECTED` with specific reasons. A configured vision-capable analysis model is required for automatic compilation. A text-only generation model may still be used after compilation.

#### 3.2 Structured generation and deterministic placement

The generation model never writes OOXML and never decides coordinates. The selected template's JSON Schema constrains the model to semantic data. Owner-scoped RAG supplies evidence from the user's uploaded documents; deterministic application logic supplies dates, configured agency/location defaults, and document-number sequences rather than allowing the model to invent them. The backend validates and normalizes the result before rendering and records source provenance for generated factual fields.

The renderer modifies a copy of the immutable original. It replaces text inside existing runs, table cells, content controls, and text frames while preserving the surrounding object and its original layout properties. It does not delete and recreate floating shapes. Repeatable body regions clone the template's own paragraph, numbering, and table styles. Static headers, footers, logos, backgrounds, section settings, and signature geometry remain byte-equivalent unless a confirmed semantic target lies inside them.

The authoritative server implementation uses a dedicated .NET service with the Open XML SDK for package-safe editing and licensed Aspose.Words for page layout, field updates, page/shape rendering, and compatibility checks. The service is isolated behind the backend and is not internet-exposed. Microsoft Word COM automation is excluded because unattended server automation is unsupported and operationally unsafe. If the Aspose license or required fonts are unavailable, readiness fails and template compilation/rendering is disabled rather than falling back to lower-fidelity Python or LibreOffice output.

#### 3.3 Render-inspect-repair fidelity gate

Every accepted original gets a baseline fixed-layout render and structural fingerprint. Each generated output is rendered again and checked before delivery. The verifier masks confirmed dynamic regions and detects movement in static regions, changed shape geometry or anchors, clipped or overflowing text, overlap, missing glyphs/fonts, broken relationships, unexpected blank pages, invalid fields, and structural corruption. Page-count changes are allowed only when they result from approved flow-body expansion; static floating objects must retain their configured anchor and geometry.

Overflow handling is deterministic and template-specific: first use an existing linked text-frame chain, then expand an explicitly resizable region, then reduce paragraph spacing or font size only within stored minimums, and finally ask the generation model to shorten that semantic field. The service renders and verifies after each bounded repair. If no policy produces a valid result, the job fails with a field-specific explanation; it never returns a degraded DOCX as successful.

For `READY` templates, the product guarantee is: existing floating shapes and static layout remain unchanged; generated content is inserted only into verified semantic targets; and the delivered file has passed structural, overflow, and rendered-layout checks. The product does not guarantee acceptance of every arbitrary DOCX or identical pagination when variable-length flow content changes.

### 4. Removal of admin, review, and LoRA product features

Remove the following runtime surfaces:

- `/api/admin/**` routes and admin JWT middleware.
- Global feedback review, approval, promotion, statistics, and review signatures.
- Training-job creation, status, cancellation, polling, and model-version activation.
- Frontend admin pages and admin/training/model API helpers.
- The LoRA service and its Docker Compose service/dependencies.

User feedback submission remains available and is ownership-scoped. It records edits for that user's own document but does not feed a global review, RAG-promotion, or training pipeline. Legacy `Feedback`, `TrainingJob`, and `ModelVersion` data is preserved in the database during this non-destructive hardening; obsolete tables can be archived or dropped only in a separately approved cleanup migration.

### 5. Frontend authentication and streaming

Signup/login/logout proxy routes create the account, set or clear the user cookie, and normalize backend validation errors for the forms; the general proxy forwards the cookie as a Bearer token to the backend. A `/me` bootstrap endpoint restores the session after refresh without exposing the token to browser JavaScript. Client helpers no longer manage a module-global token and consistently handle 401/403 responses. Navigation exposes user documents, generation, Q&A, templates, and model/API settings—no admin section.

The proxy will return backend response streams directly rather than buffering them. SSE parsers will retain fragmented lines across network chunks and flush at EOF. Generation and Q&A accept `AbortSignal`; cancellation and component unmount abort the fetch and suppress stale state updates. Sources are request-local, and low-confidence answers retain a visible warning.

Mobile navigation becomes controlled by `AppShell`. Custom dialogs move to the existing Radix dialog primitives for focus trapping, Escape handling, labeling, and focus restoration.

### 6. RAG, ingestion, and background reliability

Context packing will account for the complete rendered context—including summaries, labels, provenance, wrappers, and separators—and guarantee `context.length <= maxChars`.

Feedback promotion and its background worker are removed with the global review/training feature. Backfill records bounded per-chunk failures and continues. Self-correction always broadens a weak query even when the optional LLM rewriter is disabled. Evaluation metrics operate on exactly the first K non-summary evidence chunks.

Timeouts will expose and propagate cancellation signals. Where an operation cannot be safely cancelled, the handler will avoid claiming cancellation and will use idempotent job semantics. Workflow step timeouts must not leave background generators writing into later response stages.

Docling uploads use unique per-request temporary paths. Embeddings exposes separate liveness and readiness, with readiness returning 503 until the model is loaded; Compose and backend health checks use readiness.

### 7. Operational and dependency hygiene

Temporary secret artifacts are ignored and removed from the workspace; any values that were used outside disposable verification are rotated. Root examples use container-safe LM Studio configuration and do not silently select the cutover volume. LoRA variables, volumes, ports, health checks, and documentation are removed. Frontend dependency vulnerabilities are resolved with compatible fixed versions, not an unsafe framework downgrade.

Trailing whitespace is removed. Frontend tests become mandatory rather than passing with zero test files. CI-friendly scripts cover backend tests/build/audit, frontend tests/build/lint/audit, .NET renderer tests/build, Python syntax and contract tests, Compose validation, fresh migrations, and `git diff --check`.

## Error handling

- Authentication failures return 401; attempts to access another user's resources return 404 to avoid disclosing resource existence.
- Invalid template type/content/path returns 400, oversized files return 413, and missing templates return 404. An ambiguous template returns a successful upload with `NEEDS_REVIEW`; an unsupported or unsafe package returns a stable rejection code and never enters generation.
- Template analysis and render jobs are idempotent and bounded. Missing renderer readiness, vision capability, license, or required fonts returns 503 without changing a previously `READY` template. Fidelity-gate failures identify the semantic field and violated policy without leaking storage paths or document contents into logs.
- External service failures return bounded 502/503 responses without internal stack traces.
- Migration/import/verification scripts terminate immediately on native-command failure and never print success after partial work.
- Streaming aborts are treated as normal disconnects and do not emit a second response.

## Testing strategy

Each behavioral fix follows red-green-refactor. Required coverage includes:

- Admin routes are absent; user sessions reject malformed token-use claims and disabled/deleted users.
- LLM URL private-network and rebinding-sensitive cases.
- Cross-user document/template/feedback access, template size, DOCX/ZIP validation, external-relationship blocking, path and symlink containment, response contract, service authentication, hash verification, and shared-volume rendering.
- Additive migration on a database containing legacy templates; data-only import retains IDs and assigns `system-owner`; multiple same-kind templates per user are supported; generated static templates are not exposed as defaults.
- Structural extraction fixtures cover body text, nested tables, headers, footers, content controls, bookmarks, fields, VML and DrawingML floating text boxes, grouped shapes, linked text frames, anchors, wrapping, z-order, rotation, margins, and paragraph/run styles.
- Semantic compilation fixtures pair labeled page renders with expected field maps for representative Vietnamese administrative documents. Tests cover automatic `READY`, low-confidence `NEEDS_REVIEW`, unsupported `REJECTED`, vision-model capability failure, and a text-only generation model using an already compiled template.
- Structured generation rejects schema-invalid output and invented deterministic fields. Owner-scoped RAG provenance is retained while the renderer receives only normalized semantic values and verified template locators.
- Golden DOCX and fixed-layout render tests prove that unchanged floating-shape XML, anchors, geometry, headers, footers, tables, images, sections, and styles survive insertion. Dynamic-region masks permit intended text changes while static-region visual diffs remain within the defined threshold.
- Fidelity-gate tests cover clipped text, linked-frame flow, allowed body pagination, forbidden static-shape movement, missing fonts/glyphs, overlap, unexpected blank pages, bounded shortening, permitted minimum font/spacing adjustments, and final rejection when repair policies are exhausted.
- Renderer readiness fails closed when its document-engine license or declared font set is absent. No test or production path silently falls back to `python-docx`, LibreOffice, or Word COM for authoritative output.
- Assertions that admin/review/training/model-activation routes and the LoRA Compose service no longer exist.
- Create-account validation and duplicate handling, login success/failure and safe return paths, logout cookie clearing, session restoration, anonymous/authenticated redirects, cookie forwarding, provider-settings ownership, proxy streaming without buffering, fragmented SSE, cancellation, mobile navigation, and persistent confidence UI.
- User-owned feedback submission, bounded embedding backfill, exact context budget, self-correction flag combinations, and summary-safe evaluation metrics.
- Cutover script failure propagation, key/count/checksum verification, fresh migration deployment, Docker readiness, dependency audits, and whitespace checks.

## Acceptance criteria

- No verified Critical, High, or additional review finding remains reproducible.
- A representative Vietnamese administrative DOCX with floating text boxes compiles automatically or is explicitly marked `NEEDS_REVIEW`; once `READY`, generated output preserves all static floating-shape anchors and geometry and passes the structural and rendered-layout fidelity gate.
- Arbitrary templates that cannot meet the fidelity contract are rejected with actionable reasons; no degraded file is reported as successful.
- Backend and frontend builds pass.
- Backend and frontend test suites contain real tests and pass.
- Prisma validation and fresh-database migration deployment pass.
- Migration/import rehearsal with legacy-shaped data passes without destructive reset.
- Python syntax and remaining auxiliary-service contract tests pass.
- The .NET document-renderer builds, passes structural/golden-render tests, reports its license/font readiness, and remains inaccessible from the public network.
- Docker Compose validates and isolated service readiness succeeds.
- Backend and frontend dependency audits report no known vulnerabilities.
- `git diff --check` passes.
- The live database, volume, and running backend remain unchanged.
