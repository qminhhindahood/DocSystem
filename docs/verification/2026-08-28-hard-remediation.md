# Hard Remediation Verification — 2026-08-28

## Scope

This record covers the hard remediation work across the migration boundary, the
backend-to-conversion upload path, Redis-backed job durability and quota refunds,
conversion fidelity, frontend authentication/security, conversion state and preview
UX, accessibility, Docker packaging, and CI enforcement.

## Implemented outcomes

- The standalone Prisma schema now has a safe fresh/compatible/incompatible baseline
  detector. Compose baselines only the three compatible legacy auth tables and refuses
  an unknown schema instead of silently adopting it.
- Backend uploads stream from disk through multipart form data, enforce per-file and
  aggregate limits, and use a bounded configurable conversion timeout.
- Worker queue state is strictly Redis-backed. API reads retain only a bounded local
  fallback, and the refund journal preserves exactly-once quota recovery across worker
  failures and restarts.
- The conversion pipeline preserves block geometry and page ordering, consumes
  administrative-zone blocks exactly once, restores unconsumed blocks, and applies
  stricter running-header and cross-page table stitching rules.
- Registration has one explicit public mode, readiness rejects an invalid enabled
  configuration, proxy/session security uses validated origins and trusted client-IP
  rules, and local HTTP Compose sessions are explicitly configured without weakening
  the production cookie default.
- Conversion UI state is unified, report controls expose real confidence/coverage data,
  source PDFs load lazily into one preview, and object URLs are revoked on close and
  replacement. Product copy and metadata describe conversion only.
- The frontend design system enforces motion, reduced-motion, contrast, focus, and
  44-by-44-pixel interaction targets. CI now gates backend, frontend, conversion,
  typography, document structure, image context, dependency audits, and Compose policy.

## Automated verification

| Area | Result |
| --- | --- |
| Backend | 32 Jest suites, 272 tests passed; TypeScript build passed |
| Migration integrity | 1 suite, 5 tests passed |
| Frontend | 29 Vitest files, 229 tests passed; lint, type generation/typecheck, and Next production build passed |
| Conversion service | 152 pytest tests passed |
| Typography | Canonical JSON and Python engine synchronized for 19 roles |
| P0a document gate | All checks passed for `quyet_dinh`, `cong_van`, and `thong_bao` fixtures |
| Evaluation self-check | CER 0; block precision/recall/F1 1.0; seal recall 1.0; hallucination rate 0 |
| Operations | 29 Pester tests passed |
| Dependency audit | Backend npm, frontend npm, and Python runtime/development requirements reported no known vulnerabilities |
| Diff hygiene | `git diff --check` passed |

The Next build emits the repository's existing `@typescript/native-preview` advisory;
route type generation, explicit TypeScript checking, compilation, and static-page
generation all completed successfully.

## Database migration rehearsals

The migration service was exercised against disposable PostgreSQL volumes:

- A fresh database applied the single standalone migration successfully.
- A compatible legacy database containing `User`, `PasswordResetToken`, and
  `UserLLMConfig` retained sentinel rows, recorded the standalone baseline, and
  completed deployment.
- The detector's incompatible-schema refusal is covered by automated tests.

All rehearsal containers and volumes were removed afterward. Existing project data
volumes were retained.

## Isolated runtime smoke test

An isolated full Compose stack verified:

- frontend live and ready endpoints returned 200 in the disabled-registration mode;
- backend health and conversion readiness returned 200;
- `/signup` rendered an explicit unavailable state;
- bootstrap, login, authenticated session, and logout behavior worked;
- an invalid MIME upload returned 400 and a 51 MiB PDF upload returned 413;
- a digital PDF submission returned 202, reached `completed`, exposed a report, and
  downloaded a non-empty DOCX with the correct MIME type;
- enabling registration without Turnstile configuration made readiness return 503.

The isolated containers, images used only for rehearsal, temporary files, and four
disposable volumes were cleaned up. The user's ordinary Compose containers and
`standalone_redis_data` volume were not removed.

## Browser and accessibility verification

Chrome DevTools verification covered desktop and mobile authentication and conversion
screens:

- Lighthouse accessibility, best-practices, SEO, and agentic audits scored 100 on the
  tested login, signup, and authenticated conversion views.
- Labels, headings, landmarks, visible keyboard focus, modal focus trapping, Escape
  behavior, and focus restoration were verified.
- Dialog close, cancel, and submit controls measured at least 44 by 44 pixels.
- The completed-job report rendered real confidence (93%), coverage (100%), and
  demotion (0) values in the smoke fixture.
- The PDF source preview rendered inside exactly one labelled iframe; closing it removed
  the preview region and iframe.
- Light/dark theme switching and a clean application console were verified. The only
  form issue reported by Chrome belonged to its internal PDF viewer zoom control, not
  to the application DOM.

## Docker verification

- All service images built successfully.
- The conversion build context was approximately 16 KB.
- The conversion image contained no virtual environment, test/evaluation/work output,
  PDFs, DOCX files, or repository metadata.
- The superseded conversion image identity was absent after rebuild.
- Two pre-existing dangling images were left untouched because they were outside this
  remediation's ownership.

## Credential-dependent manual gates

Two production-integration checks remain intentionally manual because no real external
credentials were placed in scope:

- a real Gemini-backed OCR conversion;
- delivery through a production SMTP provider.

Their configuration validation and failure behavior are covered locally, but claiming
successful third-party delivery requires the deployment's own credentials and network.

## Repository state

The final combined review found and fixed two additional issues before commit:

- worker refunds now require the exact quota key captured when the job was charged,
  preventing legacy or malformed jobs from decrementing an unrelated current-day
  counter;
- unused master-stack circuit breakers, timeout configuration, and Redis workflow,
  session, planning, RAG, feedback, and export APIs were removed from the standalone
  backend.

The exact source tree then passed 272 backend tests, 229 frontend tests, 152 conversion
tests, all builds and static checks, 29 operations tests, migration/schema validation,
and production/full dependency audits with zero known vulnerabilities. A final extra
Docker rebuild could not be repeated because the host Docker Desktop Linux engine did
not become available; the successful image build, image-content inspection, migration
rehearsals, and isolated runtime smoke evidence above were retained from the immediately
preceding verification run against this remediation.

No user-owned data volume or unrelated dangling Docker image was deleted.
