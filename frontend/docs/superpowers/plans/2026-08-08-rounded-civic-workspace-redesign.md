# Rounded Civic Workspace Redesign Implementation Plan

> **For agentic workers:** Implement this plan task-by-task following the checklist and handoff log below. Track progress in this file before ending every work session.

**Goal:** Replace the current mixed Antigravity/Apple-inspired frontend with the approved Rounded Civic Workspace across every DocAI route while preserving real behavior, backend contracts, accessibility, and Vietnamese product truth.

**Architecture:** Establish one semantic token and typography contract, migrate shared primitives and the responsive application shell, then use `/documents` as the reference implementation before propagating the system through each product workflow. Existing React Query, Radix, Monaco, next-themes, and API boundaries remain in place; new components are focused presentation boundaries rather than a parallel framework.

**Tech Stack:** Next.js 16, React 19, TypeScript 7, Tailwind CSS 3, Radix UI, TanStack React Query 5, next-themes, Monaco Editor, Vitest, Testing Library, Lucide React.

**Authoritative design spec:** `docs/superpowers/specs/2026-08-08-rounded-civic-workspace-design.md`

## Global constraints

- Work in `C:\Users\PC\Documents\LLM\frontend`.
- Treat the current dirty worktree as the user-owned baseline. Never run `git reset --hard`, `git checkout --`, mass reformatting, or whole-repository rewrites.
- Before editing a listed file, inspect `git diff -- <file>` and preserve unrelated changes already present.
- Do not alter backend services, database schemas, API request/response shapes, authentication behavior, or route names.
- Do not add npm dependencies unless the user separately approves them.
- Do not fabricate folders, uploader identities, file sizes, organizations, archives, sorting, recent activity, analytics, citations, compliance, or validation results.
- Use Be Vietnam Pro for all UI copy and JetBrains Mono only for technical values.
- Light mode is the default. Dark mode remains supported and structurally identical.
- Target WCAG 2.2 AA, 44px primary mobile targets, semantic HTML, visible focus, reduced motion, and 200% zoom.
- Keep visible and accessible product copy in Vietnamese. Technical identifiers and provider/model names may remain untranslated.
- Use `apply_patch` for text edits. Run formatting tools only when they are already configured in the repository.
- Do not commit unless the user explicitly asks. Record a suggested commit message at each completed task instead.
- Do not spawn subagents unless the user explicitly requests them.
- A task is complete only when its targeted tests and the task acceptance gate pass.

---

## Continuous execution protocol

### Start or resume a session

1. Read `AGENTS.md` if present, then `PRODUCT.md`, the authoritative design spec, and this plan.
2. Run `git status --short` and inspect diffs for files belonging to the next task.
3. Find the first task whose state is `pending` or `in_progress` in the ledger below.
4. If a task is `in_progress`, read its latest handoff entry and continue from the first unchecked step.
5. Change only that task's state to `in_progress`; at most one task may be in progress.
6. Run the task's baseline test before editing. Record any pre-existing failure in the handoff log instead of silently treating it as a regression.

### End a session

1. Check every completed step in the active task.
2. Run the task's stated verification commands.
3. Update the task ledger with state, evidence, and next action.
4. Add one dated handoff row containing files changed, tests run, known failures, and the exact next unchecked step.
5. Leave the tree runnable. Do not stop with an intentionally failing test unless the handoff explicitly labels the task `blocked` and records the failure output.

### Task states

- `pending`: no implementation work started.
- `in_progress`: actively being implemented; only one task may have this state.
- `blocked`: cannot proceed without user authority, credentials, or an external service.
- `complete`: every step and acceptance gate passed.

### Change-control rules

- This plan is the execution source of truth; the design specification is the visual and behavioral source of truth.
- If the user changes the visual direction, update the specification first, record the decision in the handoff log, then revise only affected pending tasks.
- If a change affects a completed task, change that task back to `pending`, name the invalidated evidence, and rerun its full acceptance gate.
- If the backend contract changes, inspect the new type and request implementation before revising UI requirements. Never infer a contract from a screenshot.
- Never silently delete an acceptance criterion. Record why it changed and which user instruction authorized the change.
- A future agent may improve task granularity, but it must preserve task ordering, interfaces, global constraints, and completed evidence unless the user explicitly changes scope.

### Fresh-agent bootstrap instruction

Use this instruction when handing execution to a new agent:

```text
Continue the Rounded Civic Workspace redesign in
C:\Users\PC\Documents\LLM\frontend.

Do not rely on prior chat context. Read, in order:
1. AGENTS.md if present
2. PRODUCT.md
3. docs/superpowers/specs/2026-08-08-rounded-civic-workspace-design.md
4. docs/superpowers/plans/2026-08-08-rounded-civic-workspace-redesign.md

Follow the plan's Continuous execution protocol. Treat the dirty worktree as
the user's baseline, preserve unrelated changes, resume the first pending or
in-progress task, run its tests, and update the ledger and handoff log before
stopping. Do not change backend contracts, invent data, commit, or use
subagents unless the user explicitly authorizes it.
```

### Progress ledger

| Task | State | Evidence | Suggested commit |
|---|---|---|---|
| 0. Baseline and safeguards | complete | Baseline 2026-08-09: 32 files / 153 tests pass; lint clean; typecheck clean. Detector absent at `.agents/skills/impeccable/scripts/detect.mjs` (documented fallback used). | `chore: record rounded redesign baseline` |
| 1. Design contract and fonts | complete | 165 tests pass (12 added), lint + typecheck clean. Light-default tokens, 24/16/12/10/pill radii, named type ramp, DESIGN.md rewritten. | `feat: establish rounded civic design tokens` |
| 2. Shared primitives | complete | 181 tests pass (16 added), lint + typecheck clean. Normalized 7 existing controls; added EmptyState, InlineAlert, LoadingSkeleton, ConfirmDialog, PageHeader. | `feat: add rounded workspace primitives` |
| 3. Responsive application shell | complete | 184 tests pass, lint + typecheck clean. 256px sidebar, one 24px workspace, mobile-only 52px header, footer utilities, light default theme. Focus trap/Escape/restoration preserved. | `feat: rebuild authenticated workspace shell` |
| 4. Documents reference page | complete | Authenticated Chrome review completed at desktop and 390px mobile; no overflow, toolbar controls measure 44px, and console issues were repaired. The empty legitimate QA account was not populated with fabricated documents. | `feat: redesign documents workspace` |
| 5. Document trust, detail, and export | complete | 220 tests pass (11 added), lint + typecheck clean. Conditional confidence strip, recomposed detail hierarchy, explicit export confirmation that stays open on failure. All decorative italics removed. | `feat: clarify document trust and export` |
| 6. Generation workflow | complete | 232 tests pass (12 added), lint + typecheck clean. Four visible stages, `complete` maps to review not export, cancellation/EOF/recovery behavior unchanged, export behind confirmation. | `feat: stage the document generation workflow` |
| 7. Templates workflow | complete | 242 tests pass (10 added), lint + typecheck clean. All six lifecycle states labelled with a next action, confirmed deletion with row-level pending, long names wrap. | `feat: redesign template lifecycle` |
| 8. Question-answering workflow | complete | 253 tests pass (11 added), lint + typecheck clean. Answer in a named `log` region, sources in a named complementary region, persistent low-confidence and failure/retry states, cancellation preserved. | `feat: clarify answers and source provenance` |
| 9. Dashboard | complete | 259 tests pass (6 added), lint + typecheck clean. One page heading, one prominent `Tạo tài liệu` action, three real supporting rows, no fabricated metrics or recent activity. | `feat: focus the document dashboard` |
| 10. Settings | complete | 262 tests pass (3 added), lint + typecheck clean. Grouped panels, type ramp normalized across all 7 settings components, `LLMSettingsForm` localized to Vietnamese, payloads/dirty state/listbox semantics unchanged. | `feat: redesign settings workflows` |
| 11. Authentication, public, and system pages | complete | 29 targeted tests pass and typecheck is clean. User-authorized routing correction sends successful signup to the real `/dashboard` route instead of nonexistent `/settings`. | `fix: route new accounts to dashboard` |
| 12. Cross-route accessibility and responsive hardening | complete | 276 tests pass (8 added), lint + typecheck clean, `git diff --check` clean. Type ramp, radius scale, and colour tokens fully normalized; deprecated aliases retired; 4 real defects fixed. | `fix: harden redesigned frontend accessibility` |
| 13. Full verification and bounded visual polish | complete | Full authenticated/public Chrome review completed. Computed Be Vietnam Pro verified; responsive, dark mode, keyboard, console/network, and 200%-equivalent reflow checked. Q&A desktop/mobile and login mobile Lighthouse score 100 in every audited category. Final: 37 files / 283 tests, lint, build, detector (`[]`), and diff check pass. | `test: verify rounded civic redesign` |

### Handoff log

| Date | Task | Files changed | Verification | Exact next action |
|---|---|---|---|---|
| 2026-08-09 | 13. Chrome QA and repair | Added `.artifacts/redesign/chromedev-audit.md` and regression coverage; repaired root fonts, Q&A/select naming and target size, settings trigger/dirty state, auth landmark, mobile header target, document field names, and metadata. The final sibling-pattern review also made document-default loading abort-safe. | Chrome: computed Be Vietnam Pro, no responsive overflow, dark canvas `#111318`, clean settings close, clean document console. Lighthouse Q&A desktop/mobile and login mobile: 100 across accessibility, best practices, SEO, and agentic browsing. Final: 37 files / 283 tests; lint, build, detector, and diff check pass. | No implementation task remains. Preserve the QA account for future populated-data checks; do not fabricate document records. |
| 2026-08-09 | 13. Automated closure | Added `.artifacts/redesign/qa-notes.md`; updated this ledger. No UI source changed during the final pass. | Started the legitimate local data/auth stack and created a test account without weakening authentication. Chrome could list tabs but timed out on session naming, tab creation, and claiming/navigation after supported recovery attempts. Per the user's stated fallback, visual-only checkpoints were closed on automated evidence. Fresh final gate: 36 files / 276 tests pass; lint clean; typecheck clean; production build generates all 16 routes; Impeccable detector returns `[]`; `git diff --check` clean apart from line-ending notices. | No task remains in progress. A future screenshot pass requires a working browser-control connection, not a code or authentication change. |
| 2026-08-09 | 11. Signup routing correction | Modified `components/auth/AuthForm.tsx` and `test/auth-pages.test.tsx`. | Red: signup regression test failed because `AuthForm` called `/settings`. Green: `test/auth-pages.test.tsx` passes 16/16; Task 11 gate passes 29/29 across landing, auth, auth-provider, and smoke tests; typecheck clean. | Task 11 complete; resume Task 13 by starting the legitimate local stack. |
| 2026-08-08 | Planning | Added the approved design spec and this master plan. No implementation files changed. | Plan self-review required before execution. | Start Task 0, Step 1. |
| 2026-08-09 | 0. Baseline | None (read-only). | `npm test -- --run` 32 files / 153 tests pass. `npm run lint` clean. `npm run typecheck` clean. Impeccable detector script absent; used the plan's documented fallback. No pre-existing failures. | Task 0 complete; Task 1 started. |
| 2026-08-09 | 13. Final verification | No source files changed; verification only. | **Step 1 passed in full:** `npm test -- --run` 36 files / 276 tests pass · `npm run lint` clean · `npm run typecheck` clean · `npm run build` compiles all 16 routes · `git diff --check` clean (CRLF notices only) · detector absent, documented fallback used. **Steps 2–6 blocked:** `localhost:3000`, `localhost:3001/health`, and `localhost:3001/api/health` all refuse connections and no containers are running, so no authenticated session is obtainable. Route protection was not weakened to work around this. The build output independently confirms the `/settings` defect recorded above — the route list contains no `/settings` entry. | **Awaiting user:** either start the stack (`docker-compose up -d` in `C:\Users\PC\Documents\LLM`, then `npm run dev` in `backend`) and supply test credentials, or authorize closing Task 13 on automated evidence with visual QA left blocked. |
| 2026-08-09 | 12. Accessibility hardening | Modified `tailwind.config.js` (retired all deprecated aliases), `components/lib/cn.ts`, `app/error.tsx`, `test/design-system.test.ts`, `test/app-shell.test.tsx`, `test/dialogs.test.tsx`, plus token normalization across `components/{DocumentDiffViewer,DocumentEditor,StreamingDocumentEditor,TemplatePreviewModal}.tsx`, `components/feature/*`, `components/templates/*`, `components/settings/*`, `components/auth/RequireSession.tsx`. | `npm test -- --run` 36 files / 276 tests pass. `npm run lint` clean. `npm run typecheck` clean. `git diff --check` clean (only CRLF notices). Detector absent; documented fallback used. Scan for tiny text, legacy fonts, obsolete utilities, raw shadows, and italics returns clean. Reduced motion already stops pulsing via the global `animation-iteration-count: 1` rule; all wide fixed widths are `max-w-*` so none force horizontal scrolling at 360px. | Task 12 complete; start Task 13, Step 1. |
| 2026-08-09 | 11. Public, auth, system | Rewrote `app/page.tsx`, `test/landing-page.test.tsx`, `test/auth-pages.test.tsx`. Modified `components/auth/AuthForm.tsx`, `components/auth/PasswordField.tsx`, `app/(auth)/layout.tsx`, `app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx`. `app/(auth)/login/page.tsx` and `app/(auth)/signup/page.tsx` are one-line wrappers and needed no change. | `npm test -- --run` 36 files / 268 tests pass. `npm run lint` clean. `npm run typecheck` clean. `AuthForm` and `PasswordField` were **entirely in English** (`Sign in`, `Username`, `Show password`, `Passwords do not match`, …) and are now Vietnamese; validation thresholds (3–50 username, 8–100 password), autocomplete attributes, pending behavior, and both redirect destinations are unchanged. `not-found` now has one heading instead of a `404` + message pair. Error page gained a second recovery action. | Task 11 complete; start Task 12, Step 1. |
| 2026-08-09 | 10. Settings | Modified `components/settings/LLMSettingsForm.tsx` (recomposed + localized), `test/settings-page.test.tsx`, and normalized type utilities in `components/settings/{DocumentDefaultsForm,DocumentProfileForm,DocumentDefaultsDialog,LLMSettingsDialog,LLMProviderForm,OpenRouterModelPicker}.tsx`. | `npm test -- --run` 36 files / 262 tests pass. `npm run lint` clean. `npm run typecheck` clean. `test/settings-dialogs.test.tsx` and `test/openrouter-model-picker.test.tsx` pass unmodified, confirming dirty-state, save-callback, and listbox behavior are untouched. **`LLMSettingsForm` was entirely in English** (`LLM Provider`, `Save`, `Delete`, `Save failed`, …), violating the Vietnamese copy constraint; it is now localized. It is referenced only by its own test — the live dialog uses `LLMProviderForm` — so no runtime surface changed. Undefined `text-nav` was already removed in Task 1. | Task 10 complete; start Task 11, Step 1. |
| 2026-08-09 | 9. Dashboard | Rewrote `app/(app)/dashboard/page.tsx` and `test/dashboard-page.test.tsx`. | `npm test -- --run` 36 files / 259 tests pass. `npm run lint` clean. `npm run typecheck` clean. Primary action label aligned to the plan's `Tạo tài liệu`; heading promoted to the `PageHeader` level-1 contract; no data fetching added, so no counters or recent activity exist to fabricate. | Task 9 complete; start Task 10, Step 1. |
| 2026-08-09 | 8. Question answering | Recomposed `app/(app)/qa/page.tsx`. Created `test/qa-page.test.tsx`. `components/feature/SourcePanel.tsx` needed no further change (italics already removed in Task 5); `test/qa-cancellation.test.tsx` passes unmodified. | `npm test -- --run` 36 files / 253 tests pass. `npm run lint` clean. `npm run typecheck` clean. Answer region is `role="log"` named `Câu trả lời`; sources are an `aside` named `Nguồn tham khảo` shown only once an answer exists. Article/clause badges render only when the `QASource` carries those fields. Added a **persistent failure + retry state**: previously a stream error surfaced only as a transient toast, leaving no retry affordance, which the spec's required failure/retry state does not permit. Abort-safe request path unchanged. | Task 8 complete; start Task 9, Step 1. |
| 2026-08-09 | 7. Templates workflow | Rewrote `components/templates/TemplateStatusCard.tsx`. Recomposed `app/(app)/templates/page.tsx`. Modified `test/templates-page.test.tsx`. `TemplateUploadDialog`, `TemplateMappingReview`, `ReadyTemplateSelect`, `TemplateGallery`, `TemplatePreviewModal` needed no change; `test/ready-template-select.test.tsx` and `test/template-refresh.test.ts` pass unmodified. | `npm test -- --run` 35 files / 242 tests pass. `npm run lint` clean. `npm run typecheck` clean. Card review action renamed `Xem lại` → `Xem lại ánh xạ` to disambiguate from the banner action. Deletion failure is reported **inside** `ConfirmDialog`: Radix marks page content `aria-hidden` while the modal is open, so a page-level alert would be invisible to assistive technology. Processing-refresh interval behavior unchanged. | Task 7 complete; start Task 8, Step 1. |
| 2026-08-09 | 6. Generation workflow | Created `lib/ui/generation-stage.ts`, `components/feature/GenerationStages.tsx`, `test/generation-stage.test.ts`. Recomposed `app/(app)/generate/page.tsx`. Modified `test/generation-cancellation.test.tsx`. `StreamingDocumentEditor`, `DocumentEditor`, `ValidationPanel`, `FidelityWarningPanel` needed no change; `test/streaming-editor.test.tsx` and `test/editor-theme.test.ts` still pass unmodified. | `npm test -- --run` 35 files / 232 tests pass. `npm run lint` clean. `npm run typecheck` clean. SSE contract untouched: `handleGenerate`, the AbortController path, the single-active-request guard, and the "EOF without terminal event is an error" rule are byte-for-byte unchanged. Setup values and partial content survive a failure. Export now routes through `ExportConfirmationDialog`. | Task 6 complete; start Task 7, Step 1. |
| 2026-08-09 | 5. Document trust and export | Created `components/documents/DocumentConfidenceStrip.tsx`, `components/documents/ExportConfirmationDialog.tsx`. Rewrote `components/DocumentDetailModal.tsx`. Modified `test/dialogs.test.tsx`, `test/fidelity-warnings.test.tsx`, `components/feature/SourcePanel.tsx`, `components/DocumentDiffViewer.tsx`, `components/feature/TemplatePreviewModal.tsx` (italics only). | `npm test -- --run` 34 files / 220 tests pass. `npm run lint` clean. `npm run typecheck` clean. `DocumentDetail` supplies no template name, source count, or check timestamp, so `buildDocumentConfidenceItems` emits only generation state, validation status, and real fidelity warning counts; `unavailable` is never rendered as passed. Detail modal close label localized `Close` → `Đóng`. | Task 5 complete; start Task 6, Step 1. |
| 2026-08-09 | 4. Documents reference page | Created `lib/use-debounced-value.ts`, `lib/ui/document-status.ts`, `components/documents/DocumentsToolbar.tsx`, `components/documents/DocumentStatusBadge.tsx`, `test/use-debounced-value.test.tsx`, `test/document-status.test.ts`. Rewrote `app/(app)/documents/page.tsx`, `components/DocumentCard.tsx`, `test/documents-page.test.tsx`. | `npm test -- --run` 34 files / 209 tests pass. `npm run lint` clean. `npm run typecheck` clean. Status mapping covers the statuses the backend actually writes (`draft`, `uploaded`) plus the schema-documented `pending`/`approved`/`published` and the filter's `final`, with a neutral fallback. Step 9 authenticated screenshot checkpoint is **blocked**: no running stack or test credentials in this session. | Task 4 complete; start Task 5, Step 1. |
| 2026-08-09 | 3. Application shell | `components/layout/AppShell.tsx`, `components/layout/Sidebar.tsx`, `components/layout/Header.tsx`, `components/providers/ThemeProvider.tsx`, `components/settings/LLMSettingsDialog.tsx` (trigger only), `lib/constants/routes.ts`, `lib/constants/routes.test.ts`, `test/app-shell.test.tsx`. `app/(app)/layout.tsx` needed no change. | `npm test -- --run` 32 files / 184 tests pass. `npm run lint` clean. `npm run typecheck` clean. Notes: nav label `Templates` localized to `Mẫu văn bản`; shell labels localized (`Mở điều hướng`, `Đóng điều hướng`, `Bỏ qua tới nội dung chính`); theme/logout buttons take their accessible name from visible text per WCAG 2.5.3; lucide mock made `aria-hidden` so stub text no longer leaks into accessible names. | Task 3 complete; start Task 4, Step 1. |
| 2026-08-09 | 2. Shared primitives | Created `components/ui/empty-state.tsx`, `components/ui/inline-alert.tsx`, `components/ui/loading-skeleton.tsx`, `components/ui/confirm-dialog.tsx`, `components/layout/PageHeader.tsx`. Modified `components/ui/{button,card,input,select,textarea,badge,toast}.tsx` and `test/ui-primitives.test.tsx`. | `npm test -- --run` 32 files / 181 tests pass. `npm run lint` clean. `npm run typecheck` clean. `test/dialogs.test.tsx` needed no change; existing modal behavior preserved. | Task 2 complete; start Task 3, Step 1. |
| 2026-08-09 | 1. Design contract | `DESIGN.md` (rewritten), `app/layout.tsx`, `app/globals.css` (rewritten), `tailwind.config.js`, `components/lib/cn.ts`, `components/ui/button.tsx`, `test/design-system.test.ts`, `test/contrast.test.ts`, `test/ui-primitives.test.tsx`, plus mechanical utility replacements in `app/page.tsx`, `app/not-found.tsx`, `app/(app)/dashboard/page.tsx`, `app/(app)/qa/page.tsx`, `components/DocumentDetailModal.tsx`, `components/TemplatePreviewModal.tsx`, `components/feature/SourcePanel.tsx`, `components/feature/TemplateGallery.tsx`, `components/settings/OpenRouterModelPicker.tsx`, `components/settings/DocumentProfileForm.tsx`. | `npm test -- --run` 32 files / 165 tests pass. `npm run lint` clean. `npm run typecheck` clean. Two deviations recorded below. | Task 1 complete; start Task 2, Step 1. |

### Recorded deviations from the specification

| Date | Task | Deviation | Authority |
|---|---|---|---|
| 2026-08-09 | 1 | Light `--color-text-muted` implemented as `#646D80` instead of the spec's `#768095`. The spec value measures 3.97:1 on `#FFFFFF` and 3.44:1 on `#ECEFF3`, failing the spec's own WCAG 2.2 AA requirement. `#646D80` is the lightest value in the same hue clearing 4.5:1 on canvas, workspace, subtle, and strong surfaces. | Specification's accessibility contract outranks its literal token table (reference hierarchy item 2 over item 3). Enforced by `test/contrast.test.ts`. |
| 2026-08-09 | 1 | `test/contrast.test.ts` asserts 3:1 for the focus ring against canvas and workspace rather than for `--color-border-strong` against its surface. | WCAG 2.2 1.4.11 applies 3:1 to focus indicators and control boundaries, not decorative hairlines. The spec authorizes "fine borders", which cannot also satisfy 3:1. |
| 2026-08-09 | 11 | Landing page hero/workflow previews were replaced with three descriptive workflow-stage cards instead of being restyled. | The previews contained fabricated data the global constraints forbid: `1,240 đoạn ngữ nghĩa`, `Căn cứ 100%`, `0 Lỗi thể thức`, `45 Điều`, `Mẫu 1.1`, and three invented filenames presented as a real document list. No backend contract supplies any of it. Three placeholder social links pointing at `#` were also removed. |
| 2026-08-09 | 11 | Auth branding claim `Kiểm tra lỗi thể thức văn bản hành chính 100%` replaced with `Kiểm tra thành phần thể thức và hiển thị kết quả trước khi xuất`. | The implementation cannot substantiate a 100% guarantee; `FidelityWarningPanel` explicitly models `warnings` and `unavailable` validation states. |

### Defects found and fixed while implementing

| Date | Task | Defect | Fix |
|---|---|---|---|
| 2026-08-09 | 11 | `AuthForm` redirected successful signup to `/settings`, but no `/settings` route exists, sending every new account to the 404 page. | User authorized the navigation correction. Signup now redirects to `/dashboard`, where the authenticated shell exposes document workflows and the sidebar settings control. Regression covered by `test/auth-pages.test.tsx`. |
| 2026-08-09 | 12 | `bg-text-tertiary` / `text-text-tertiary` were used in `StreamingDocumentEditor`, `DocumentEditor`, and `generate/page.tsx`, but no `text-tertiary` colour was ever defined in `tailwind.config.js`. The affected dots and icons silently rendered with no colour. | Repointed to `text-text-muted` / `bg-surface-strong`. Regression covered by the "keeps every colour on a semantic token" assertion. |
| 2026-08-09 | 12 | `text-white` on filled `bg-error` / `bg-success` buttons in `StreamingDocumentEditor` bypassed the palette, so the foreground did not follow the theme. | Replaced with `text-on-action`. |
| 2026-08-09 | 12 | `app/error.tsx` used `<h2>` as its only heading, so the standalone error page had no level-1 heading and started the outline at level 2. | Promoted to `<h1>`. Regression covered by "starts each standalone system page at heading level 1". |
| 2026-08-09 | 12 | Three English `aria-label`s remained (`Close` ×2, `Remove mapping`), violating the Vietnamese accessibility-copy constraint. | Localized to `Đóng` and `Xóa ánh xạ`. Regression covered by "keeps accessible names in Vietnamese". |
| 2026-08-09 | 1 | `components/lib/cn.ts` used bare `twMerge`, which classified custom `text-*` scale keys as *colors*. Because `Button` applies `sizes` after `variants`, `text-body` silently removed `text-on-action` from every primary and destructive button. Pre-existing, not introduced by this redesign. | Replaced with `extendTailwindMerge`, declaring the custom `font-size`, `rounded`, and `shadow` class groups. Regression covered by the destructive-button assertion in `test/ui-primitives.test.tsx`. |

---

## File ownership map

### Design foundations

- `DESIGN.md`: concise repository-level design contract; must point to and agree with the approved specification.
- `app/layout.tsx`: font loading and root font variables.
- `app/globals.css`: semantic CSS tokens, base typography, focus, motion, and reusable low-level utility classes.
- `tailwind.config.js`: Tailwind aliases for the exact semantic tokens and named type scale.
- `test/design-system.test.ts`: source-level enforcement against legacy fonts, tiny text, raw glow, and obsolete tokens.
- `test/contrast.test.ts`: contrast checks for light and dark semantic color pairs.

### Shared UI and shell

- `components/ui/*`: behavior-preserving reusable controls.
- `components/layout/AppShell.tsx`: outer canvas, desktop/mobile topology, main landmark.
- `components/layout/Sidebar.tsx`: desktop navigation, mobile drawer, footer utilities.
- `components/layout/Header.tsx`: mobile-only header after migration.
- `components/layout/PageHeader.tsx`: route title, supporting text, and actions.
- `components/providers/ThemeProvider.tsx`: light default and persisted manual theme.
- `test/ui-primitives.test.tsx`, `test/dialogs.test.tsx`, `test/app-shell.test.tsx`, `test/theme-hydration.test.tsx`: shared behavior contract.

### Documents

- `app/(app)/documents/page.tsx`: query state, filters, pagination, detail selection, and route composition.
- `components/DocumentCard.tsx`: responsive document row/list item.
- `components/DocumentDetailModal.tsx`: detail hierarchy and export entry point.
- `components/documents/DocumentsToolbar.tsx`: search, filters, and clear action.
- `components/documents/DocumentStatusBadge.tsx`: exhaustive localized status presentation.
- `components/documents/DocumentConfidenceStrip.tsx`: conditional provenance and validation summary.
- `components/documents/ExportConfirmationDialog.tsx`: explicit safe-export confirmation.
- `lib/use-debounced-value.ts`: reusable 275ms query debounce.
- `lib/ui/document-status.ts`: pure status-to-presentation mapping.
- `test/use-debounced-value.test.tsx`: deterministic timer coverage for search debounce.
- `test/document-status.test.ts`: exhaustive status presentation coverage.
- `test/documents-page.test.tsx`, `test/dialogs.test.tsx`: document behavior and accessibility.

### Product workflows

- `app/(app)/generate/page.tsx`, `components/StreamingDocumentEditor.tsx`, `components/DocumentEditor.tsx`, `components/feature/FidelityWarningPanel.tsx`, `components/feature/ValidationPanel.tsx`: staged generation and review.
- `app/(app)/templates/page.tsx`, `components/templates/*`, `components/feature/TemplateGallery.tsx`, `components/feature/TemplatePreviewModal.tsx`: template lifecycle.
- `app/(app)/qa/page.tsx`, `components/feature/SourcePanel.tsx`: answer and provenance layout.
- `app/(app)/dashboard/page.tsx`: primary action and workflow entry points.
- `components/settings/*`: grouped settings forms and dialogs.
- `components/auth/*`, `app/(auth)/*`, `app/page.tsx`, `app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx`: public and system surfaces.

---

### Task 0: Establish the baseline and safeguards

**Files:**

- Modify: this plan's progress ledger and handoff log only.
- Inspect: every file listed in the ownership map.

**Interfaces:**

- Consumes: current dirty worktree and existing test suite.
- Produces: recorded baseline results and an exact list of pre-existing failures.

- [ ] **Step 1: Read repository instructions and source-of-truth documents**

Run:

```bash
cat PRODUCT.md
cat docs/superpowers/specs/2026-08-08-rounded-civic-workspace-design.md
cat docs/superpowers/plans/2026-08-08-rounded-civic-workspace-redesign.md
```

Expected: the product, design specification, and execution protocol agree on scope and API preservation.

- [ ] **Step 2: Record the dirty baseline without changing it**

Run:

```bash
git status --short
git diff --stat
```

Expected: existing modifications are recorded in the handoff log; none are reverted.

- [ ] **Step 3: Run the current automated baseline**

Run:

```bash
npm test -- --run
npm run lint
npm run typecheck
```

Expected: record every pass or failure verbatim in the ledger. A pre-existing failure does not authorize skipping later regression checks.

- [ ] **Step 4: Run the design detector**

Run:

```bash
node .agents/skills/impeccable/scripts/detect.mjs --json . 2>/dev/null || echo 'Design detector not available, skipping.'
```

Expected baseline: legacy Google font declarations, small font sizes, and raw design values may still be reported. Save the count and categories in the handoff log.

- [ ] **Step 5: Mark Task 0 complete**

Acceptance gate: baseline commands and detector evidence are recorded, no implementation file changed, and Task 1 is the only next action.

---

### Task 1: Replace the design contract and harden font loading

**Files:**

- Modify: `DESIGN.md`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `tailwind.config.js`
- Modify: `test/design-system.test.ts`
- Modify: `test/contrast.test.ts`

**Interfaces:**

- Consumes: the token values and type scale in the authoritative design spec.
- Produces: Tailwind utilities `text-page-title`, `text-section-title`, `text-body`, `text-control`, `text-metadata`, `text-technical`; radii `workspace`, `panel`, `control`, `compact`, `pill`; semantic color utilities already named in `tailwind.config.js`.

- [ ] **Step 1: Inspect existing changes before editing**

Run:

```bash
git diff -- DESIGN.md app/layout.tsx app/globals.css tailwind.config.js test/design-system.test.ts test/contrast.test.ts
```

Expected: understand which edits predate this task and preserve nonvisual behavior.

- [ ] **Step 2: Replace the old design assertions with failing Rounded Civic assertions**

Update `test/design-system.test.ts` so it reads the source files and asserts all of the following:

```ts
expect(layoutSource).toContain('Be_Vietnam_Pro');
expect(layoutSource).toContain('JetBrains_Mono');
expect(layoutSource).not.toMatch(/Inter|Plus_Jakarta_Sans|Playfair_Display/);
expect(globalCss).toContain('--radius-workspace: 24px');
expect(globalCss).toContain('--radius-panel: 16px');
expect(globalCss).toContain('--radius-control: 12px');
expect(globalCss).toContain('font-synthesis: none');
expect(uiSource).not.toMatch(/Google Sans|shadow-glow|shadow-\[[^\]]*rgba|text-\[11px\]/);
expect(tailwindSource).toContain("'page-title'");
expect(tailwindSource).toContain("'section-title'");
expect(tailwindSource).toContain("'metadata'");
```

- [ ] **Step 3: Run the targeted tests and confirm failure**

Run:

```bash
npm test -- --run test/design-system.test.ts test/contrast.test.ts
```

Expected: fail because the current implementation still declares legacy fonts, 24px radii at every level, and the previous dark-first contract.

- [ ] **Step 4: Reduce root font loading to the approved families**

Implement this shape in `app/layout.tsx`:

```ts
const beVietnam = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-be-vietnam',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains',
});
```

The body class contains only these two generated variables.

- [ ] **Step 5: Implement the semantic CSS contract**

In `app/globals.css`:

- Remove local Google font-face declarations.
- Make light tokens the `:root` default and dark tokens `[data-theme='dark']` overrides.
- Add the exact color, radius, elevation, and motion values from the spec.
- Set `font-family: var(--font-text)`, `font-size: 16px`, and `font-synthesis: none` on `body`.
- Replace the raw `rgba(26, 115, 232, 0.2)` focus shadow with a tokenized ring.
- Retain Monaco, selection, diff, scrollbar, skip-link, and reduced-motion behavior.

- [ ] **Step 6: Implement the exact Tailwind aliases**

Use this type contract in `tailwind.config.js`:

```js
fontSize: {
  'page-title': ['28px', { lineHeight: '36px', fontWeight: '700' }],
  'section-title': ['20px', { lineHeight: '28px', fontWeight: '600' }],
  body: ['16px', { lineHeight: '24px', fontWeight: '400' }],
  control: ['14px', { lineHeight: '20px', fontWeight: '500' }],
  metadata: ['13px', { lineHeight: '18px', fontWeight: '400' }],
  technical: ['12px', { lineHeight: '16px', fontWeight: '500' }],
}
```

Map radii to `--radius-workspace`, `--radius-panel`, `--radius-control`, `--radius-compact`, and `--radius-pill`. Remove obsolete typography aliases only after replacing every use in repository source.

- [ ] **Step 7: Replace the repository design document carefully**

Rewrite `DESIGN.md` as the concise implementation contract for Rounded Civic Workspace. It must link to the authoritative spec, list the normative tokens, state the reference hierarchy, and explicitly supersede Antigravity and Apple-inspired styling. Preserve product facts but remove contradictory design directions.

- [ ] **Step 8: Run targeted verification**

Run:

```bash
npm test -- --run test/design-system.test.ts test/contrast.test.ts test/theme-hydration.test.tsx
npm run typecheck
node .agents/skills/impeccable/scripts/detect.mjs --json . 2>/dev/null || echo 'Design detector not available, skipping.'
```

Acceptance gate: targeted tests pass; Be Vietnam Pro renders the only UI family; every used named type utility exists; detector reports no legacy Google font or 11px UI finding.

---

### Task 2: Build behavior-preserving shared primitives

**Files:**

- Modify: `components/ui/button.tsx`
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/select.tsx`
- Modify: `components/ui/textarea.tsx`
- Modify: `components/ui/badge.tsx`
- Modify: `components/ui/toast.tsx`
- Create: `components/ui/empty-state.tsx`
- Create: `components/ui/inline-alert.tsx`
- Create: `components/ui/loading-skeleton.tsx`
- Create: `components/ui/confirm-dialog.tsx`
- Create: `components/layout/PageHeader.tsx`
- Modify: `test/ui-primitives.test.tsx`
- Modify: `test/dialogs.test.tsx`

**Interfaces:**

- Produces:

```ts
export interface PageHeaderProps {
  title: string;
  description?: string;
  meta?: React.ReactNode;
  actions?: React.ReactNode;
}

export interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
}

export interface InlineAlertProps {
  variant: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void | Promise<void>;
}
```

- [ ] **Step 1: Write failing primitive behavior tests**

Add tests for:

```tsx
expect(screen.getByRole('heading', { name: 'Tài liệu', level: 1 })).toBeVisible();
expect(screen.getByRole('button', { name: 'Xóa tài liệu' })).toHaveClass('min-h-11');
expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby');
expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải dữ liệu');
```

Also assert that disabled and pending buttons retain labels, focus rings are tokenized, dialogs restore focus, and a loading skeleton is hidden from assistive technology while its container exposes a Vietnamese loading label.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run:

```bash
npm test -- --run test/ui-primitives.test.tsx test/dialogs.test.tsx
```

- [ ] **Step 3: Normalize existing controls**

Update existing primitives to use semantic tokens, 12px ordinary radii, 44px touch height where required, clear disabled/pending states, and no glow or hover translation. Preserve their current prop signatures unless the new props above explicitly extend them.

- [ ] **Step 4: Add the new focused primitives**

Implement the exported interfaces exactly. `ConfirmDialog` must use the repository's Radix Dialog dependency, prevent duplicate confirmation while pending, close only after successful synchronous or asynchronous confirmation, and keep the dialog open if the callback rejects.

- [ ] **Step 5: Run targeted verification**

Run:

```bash
npm test -- --run test/ui-primitives.test.tsx test/dialogs.test.tsx
npm run typecheck
```

Acceptance gate: shared states are accessible, visually tokenized, and no consumer-facing API used elsewhere is broken.

---

### Task 3: Rebuild the responsive authenticated shell

**Files:**

- Modify: `components/layout/AppShell.tsx`
- Modify: `components/layout/Sidebar.tsx`
- Modify: `components/layout/Header.tsx`
- Modify: `components/providers/ThemeProvider.tsx`
- Modify: `app/(app)/layout.tsx`
- Modify: `test/app-shell.test.tsx`
- Modify: `test/theme-hydration.test.tsx`

**Interfaces:**

- Preserves: `AppShell({ children })`, `Sidebar({ open, onOpenChange, triggerRef, className })`, and the current mobile focus-management contract.
- Produces: 256px desktop sidebar, 52px mobile header, and one rounded desktop workspace.

- [ ] **Step 1: Write failing shell tests**

Assert:

```tsx
expect(screen.getByTestId('app-sidebar')).toHaveClass('lg:w-64');
expect(screen.getByTestId('app-workspace')).toHaveClass('lg:rounded-workspace');
expect(screen.getByTestId('mobile-header')).toHaveClass('lg:hidden');
expect(screen.getByRole('button', { name: 'Chuyển giao diện' })).toBeVisible();
```

Keep the existing focus trap, Escape, focus restoration, skip-link, inert-background, and 44px target assertions.

- [ ] **Step 2: Run shell tests and confirm failure**

Run:

```bash
npm test -- --run test/app-shell.test.tsx test/theme-hydration.test.tsx
```

- [ ] **Step 3: Implement desktop topology**

Use a neutral outer canvas with 16px padding, 256px sidebar, and one flexing workspace with `rounded-workspace`, `overflow-hidden`, and the workspace shadow. Remove the desktop global header; the main landmark scrolls inside the workspace.

- [ ] **Step 4: Implement mobile topology**

Keep `Header` only below `lg`. Preserve the current drawer semantics and focus management. Ensure the closed drawer is non-interactive and the main region is hidden from assistive technology only while the modal drawer is open.

- [ ] **Step 5: Move utility controls to the sidebar footer**

Place theme, settings/help access when supported, and account/logout controls in the footer. Keep every label Vietnamese. Do not invent a user organization or avatar value.

- [ ] **Step 6: Make light theme the default**

Configure `next-themes` to default to `light`, preserve manual theme persistence, and avoid server/client hydration mismatch.

- [ ] **Step 7: Run targeted verification**

Run:

```bash
npm test -- --run test/app-shell.test.tsx test/theme-hydration.test.tsx test/smoke.test.tsx
npm run typecheck
```

Acceptance gate: desktop has one workspace and no duplicate header; mobile drawer behavior is unchanged; light and dark theme hydration tests pass.

---

### Task 4: Implement `/documents` as the visual reference page

**Files:**

- Modify: `app/(app)/documents/page.tsx`
- Modify: `components/DocumentCard.tsx`
- Create: `components/documents/DocumentsToolbar.tsx`
- Create: `components/documents/DocumentStatusBadge.tsx`
- Create: `lib/use-debounced-value.ts`
- Create: `lib/ui/document-status.ts`
- Create: `test/use-debounced-value.test.tsx`
- Create: `test/document-status.test.ts`
- Modify: `test/documents-page.test.tsx`

**Interfaces:**

```ts
export function useDebouncedValue<T>(value: T, delayMs: number): T;

export type DocumentStatusPresentation = {
  label: string;
  variant: 'neutral' | 'info' | 'success' | 'warning';
};

export function getDocumentStatusPresentation(status: string): DocumentStatusPresentation;

export interface DocumentsToolbarProps {
  search: string;
  documentType: string;
  status: string;
  onSearchChange: (value: string) => void;
  onDocumentTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onClear: () => void;
}
```

- [ ] **Step 1: Add failing pure mapping and debounce tests**

Test the exact status behavior:

```ts
expect(getDocumentStatusPresentation('draft')).toEqual({ label: 'Bản nháp', variant: 'info' });
expect(getDocumentStatusPresentation('final')).toEqual({ label: 'Hoàn chỉnh', variant: 'success' });
expect(getDocumentStatusPresentation('unexpected')).toEqual({ label: 'Trạng thái khác', variant: 'neutral' });
```

In `test/use-debounced-value.test.tsx`, use a small harness that prints the hook result. With fake timers, render the harness with `value="cũ"`, rerender with `value="mới"`, assert `cũ` through 274ms, advance one more millisecond inside `act`, then assert `mới`.

- [ ] **Step 2: Add failing page behavior tests**

Extend `test/documents-page.test.tsx` to assert:

- Search waits 275ms before adding `q` to `listDocuments`.
- Search and filter changes reset offset to zero.
- Existing rows remain visible while the next query fetches.
- Clear filters resets search, type, status, and pagination.
- Supported columns are visible; unsupported folder, uploader, size, archive, recent, and sort labels are absent.
- A detail request disables or marks only the selected row as busy.
- Empty, filtered-empty, list error, detail error, pagination, and retry states remain Vietnamese and accessible.

- [ ] **Step 3: Run the document tests and confirm failure**

Run:

```bash
npm test -- --run test/document-status.test.ts test/use-debounced-value.test.tsx test/documents-page.test.tsx
```

- [ ] **Step 4: Implement the pure helpers**

Create the debounce hook with `useEffect` cleanup and the status mapping with a neutral fallback. Keep the status function free of React and API calls.

- [ ] **Step 5: Implement the rounded toolbar**

Use the approved `PageHeader`, search field, two existing select controls, and a conditional clear action. Use `aria-label` for each filter. Search state updates immediately; only the debounced value enters the React Query key and request.

- [ ] **Step 6: Implement stable querying**

Import `keepPreviousData` from TanStack React Query and configure:

```ts
placeholderData: keepPreviousData
```

Use the debounced search value in `queryKey` and `listDocuments`. Reset the page to one when immediate search or filters change. Keep list errors distinct from detail errors.

- [ ] **Step 7: Convert `DocumentCard` into a responsive row**

Desktop uses a semantic table or table-like labelled grid with title, type, updated date, status, and row action. Mobile uses a labelled stacked row. Use only `DocumentListItem` fields. Long titles wrap to two lines on desktop and naturally on mobile.

- [ ] **Step 8: Run reference-page verification**

Run:

```bash
npm test -- --run test/document-status.test.ts test/use-debounced-value.test.tsx test/documents-page.test.tsx test/design-system.test.ts
npm run typecheck
npm run lint
```

Acceptance gate: the route satisfies every Documents section requirement in the spec and becomes the reference visual grammar for Tasks 5–11.

- [x] **Step 9: Capture the reference checkpoint**

With a legitimate authenticated local session, capture desktop 1440px and mobile 390px screenshots in light mode. If credentials are unavailable, record `blocked: authenticated visual checkpoint` in the handoff log but continue only with automated checks; never bypass authentication.

Closure note (2026-08-09): completed through authenticated Chrome DevTools at desktop and 390px mobile. The account's document library was empty, so no fabricated row or detail record was introduced. Screenshots were delivered inline because DevTools rejected repository screenshot paths; durable findings are in `.artifacts/redesign/chromedev-audit.md`.

---

### Task 5: Add document confidence, detail hierarchy, and safe export

**Files:**

- Modify: `components/DocumentDetailModal.tsx`
- Create: `components/documents/DocumentConfidenceStrip.tsx`
- Create: `components/documents/ExportConfirmationDialog.tsx`
- Modify: `components/feature/FidelityWarningPanel.tsx`
- Modify: `components/feature/SourcePanel.tsx`
- Modify: `test/dialogs.test.tsx`
- Modify: `test/fidelity-warnings.test.tsx`

**Interfaces:**

```ts
export interface ConfidenceItem {
  id: 'template' | 'sources' | 'generation' | 'validation' | 'fidelity' | 'checked';
  label: string;
  value: string;
  tone?: 'neutral' | 'positive' | 'warning';
}

export interface DocumentConfidenceStripProps {
  items: ConfidenceItem[];
  action?: React.ReactNode;
}

export interface ExportConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filename: string;
  validationStatus?: 'passed' | 'warnings' | 'unavailable';
  pending: boolean;
  onConfirm: () => Promise<void>;
}
```

- [ ] **Step 1: Write failing confidence and export tests**

Assert the confidence strip returns no markup for an empty `items` array, shows only supplied values, never labels `unavailable` as passed, and announces export success/failure. Assert the export dialog names the DOCX filename and retains focus while pending.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run:

```bash
npm test -- --run test/dialogs.test.tsx test/fidelity-warnings.test.tsx
```

- [ ] **Step 3: Implement the conditional confidence strip**

Render a single 16px-radius summary row with one labelled group per supplied item. Collapse to a vertical list below 640px. Do not infer template name, check time, source count, or validation from absent fields.

- [ ] **Step 4: Recompose document detail**

Order content as identity/actions, confidence strip when available, document body, chunks/sources, fidelity/validation, feedback, and metadata. Remove decorative italics. Keep modal open/close semantics and detail content behavior unchanged.

- [ ] **Step 5: Add explicit export confirmation**

Call the existing `downloadDocumentAsDocx` only after confirmation. Present filename, `DOCX`, and the known fidelity state. Disable duplicate confirmation while pending; on error keep the dialog open and expose a persistent inline alert.

- [ ] **Step 6: Run targeted verification**

Run:

```bash
npm test -- --run test/dialogs.test.tsx test/fidelity-warnings.test.tsx test/documents-page.test.tsx
npm run typecheck
```

Acceptance gate: every trust statement is backed by `DocumentDetail` data, export is explicit and recoverable, and no compliance claim is added.

---

### Task 6: Restructure generation as a four-stage workflow

**Files:**

- Modify: `app/(app)/generate/page.tsx`
- Modify: `components/StreamingDocumentEditor.tsx`
- Modify: `components/DocumentEditor.tsx`
- Modify: `components/feature/ValidationPanel.tsx`
- Modify: `components/feature/FidelityWarningPanel.tsx`
- Modify: `test/generation-cancellation.test.tsx`
- Modify: `test/streaming-editor.test.tsx`
- Modify: `test/editor-theme.test.ts`
- Create: `lib/ui/generation-stage.ts`
- Create: `test/generation-stage.test.ts`

**Interfaces:**

```ts
export type GenerationStep = 'setup' | 'compose' | 'review' | 'export';

export function mapStreamStageToGenerationStep(
  stage: 'planning' | 'researching' | 'writing' | 'complete' | 'warning',
): GenerationStep;
```

Implement this pure function in `lib/ui/generation-stage.ts`. Mapping: `planning` and `researching` → `compose`; `writing` → `compose`; `warning` → `review`; `complete` → `review` until the user enters export.

- [ ] **Step 1: Write failing stage and recovery tests**

Test all stream-stage mappings, cancellation before the first chunk, cancellation during streaming, EOF without a terminal event, preservation of setup values after failure, and visibility of partial content after a recoverable error.

- [ ] **Step 2: Run generation tests and confirm failure only for new presentation requirements**

Add `test/generation-stage.test.ts` with one assertion for every `StreamChunk['stage']`, then run:

```bash
npm test -- --run test/generation-stage.test.ts test/generation-cancellation.test.tsx test/streaming-editor.test.tsx test/editor-theme.test.ts
```

- [ ] **Step 3: Add the stage presentation**

Render `Thiết lập`, `Soạn nội dung`, `Kiểm tra`, and `Xuất tài liệu` as an ordered progress element. Mark current and completed steps with text and icon, not color alone. On mobile show the current step plus `Bước n / 4` without horizontal overflow.

- [ ] **Step 4: Recompose setup and editor surfaces**

Use one dominant setup panel, one clear primary action, and compact optional settings. During composition, keep progress and cancellation near the editor. The document remains the visual center; validation and sources are supporting panels.

- [ ] **Step 5: Preserve the request lifecycle**

Do not change SSE event types. Keep one active request, use the current AbortSignal path, treat missing terminal completion as failure, and retain input/editor state on retry.

- [ ] **Step 6: Connect review and export trust states**

Reuse `DocumentConfidenceStrip`, `ValidationPanel`, `FidelityWarningPanel`, and `ExportConfirmationDialog` only with real stream or document values.

- [ ] **Step 7: Run targeted verification**

Run:

```bash
npm test -- --run test/generation-stage.test.ts test/generation-cancellation.test.tsx test/streaming-editor.test.tsx test/editor-theme.test.ts test/fidelity-warnings.test.tsx
npm run typecheck
```

Acceptance gate: all four stages are understandable, cancellation and error recovery remain intact, and the flow never marks incomplete output as successful.

---

### Task 7: Redesign the template lifecycle

**Files:**

- Modify: `app/(app)/templates/page.tsx`
- Modify: `components/templates/TemplateUploadDialog.tsx`
- Modify: `components/templates/TemplateStatusCard.tsx`
- Modify: `components/templates/TemplateMappingReview.tsx`
- Modify: `components/templates/ReadyTemplateSelect.tsx`
- Modify: `components/feature/TemplateGallery.tsx`
- Modify: `components/feature/TemplatePreviewModal.tsx`
- Modify: `test/templates-page.test.tsx`
- Modify: `test/template-refresh.test.ts`
- Modify: `test/ready-template-select.test.tsx`

**Interfaces:** preserve all current template API and component callback signatures.

- [ ] **Step 1: Add failing lifecycle presentation tests**

For each real status, assert a localized label, semantic icon, state-specific action, and no unsupported fidelity promise. Add tests for long template names, delete confirmation, row-level pending state, and keyboard selection in `ReadyTemplateSelect`.

- [ ] **Step 2: Run template tests and confirm failure for the new layout assertions**

Run:

```bash
npm test -- --run test/templates-page.test.tsx test/template-refresh.test.ts test/ready-template-select.test.tsx
```

- [ ] **Step 3: Recompose the page using the reference grammar**

Use `PageHeader`, a compact upload action, one filter/status region if already supported, and a calm responsive list/grid. Keep processing refresh behavior and mapping-review navigation unchanged.

- [ ] **Step 4: Normalize status cards and mapping review**

Use one outer boundary, 12px row/card radius, explicit status, concise reason text, and visible next action. Mapping review gets a fixed workflow header and a responsive comparison area without nested decorative cards.

- [ ] **Step 5: Add safe deletion feedback**

Use `ConfirmDialog`; keep the selected template visible and pending until deletion resolves. On failure keep it in place and show an inline error.

- [ ] **Step 6: Run targeted verification**

Run:

```bash
npm test -- --run test/templates-page.test.tsx test/template-refresh.test.ts test/ready-template-select.test.tsx test/dialogs.test.tsx
npm run typecheck
```

Acceptance gate: every lifecycle state remains operational and truthful, and template selection works with keyboard and long Vietnamese content.

---

### Task 8: Clarify question answering and source provenance

**Files:**

- Modify: `app/(app)/qa/page.tsx`
- Modify: `components/feature/SourcePanel.tsx`
- Modify: `test/qa-cancellation.test.tsx`
- Create: `test/qa-page.test.tsx`

**Interfaces:** preserve `QAMessage`, `QAAnswer`, `QASource`, and current abort-safe request behavior.

- [ ] **Step 1: Write failing QA layout and provenance tests**

Assert the answer appears in the primary region, sources have a named complementary region, source count matches supplied data, low-confidence copy is visible when true, absent article/clause values are omitted, and cancellation does not begin a second request.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run:

```bash
npm test -- --run test/qa-page.test.tsx test/qa-cancellation.test.tsx
```

- [ ] **Step 3: Recompose the QA workspace**

Use `PageHeader`, a primary answer conversation region, and a secondary source panel at desktop widths. Stack sources below answers on mobile. Keep the question composer reachable without a sticky element obscuring content.

- [ ] **Step 4: Harden answer states**

Provide distinct initial, submitting, streaming, cancelled, no-source, low-confidence, failure, and retry states. Do not fabricate citation numbering or legal authority.

- [ ] **Step 5: Run targeted verification**

Run:

```bash
npm test -- --run test/qa-page.test.tsx test/qa-cancellation.test.tsx test/api-cancellation.test.ts
npm run typecheck
```

Acceptance gate: answer/source hierarchy is obvious and all provenance remains backed by `QASource` fields.

---

### Task 9: Focus the dashboard on the primary workflow

**Files:**

- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `test/dashboard-page.test.tsx`

**Interfaces:** no new data fetching and no API changes.

- [ ] **Step 1: Write failing content and hierarchy tests**

Assert there is exactly one prominent `Tạo tài liệu` link, supporting links to `/documents`, `/templates`, and `/qa`, one page heading, no fabricated statistics or recent activity, and no duplicated global header.

- [ ] **Step 2: Run the dashboard test and confirm failure for the new structure**

Run:

```bash
npm test -- --run test/dashboard-page.test.tsx
```

- [ ] **Step 3: Implement the focused composition**

Use a short welcome heading, one dominant generation panel, and three compact supporting workflow rows. Use product-specific copy about creating, reviewing, and grounding documents; avoid generic productivity claims.

- [ ] **Step 4: Run targeted verification**

Run:

```bash
npm test -- --run test/dashboard-page.test.tsx test/app-shell.test.tsx
npm run typecheck
```

Acceptance gate: the first action is unambiguous, every secondary action is real, and the route follows the Documents reference grammar.

---

### Task 10: Redesign settings without changing persistence behavior

**Files:**

- Modify: `components/settings/DocumentDefaultsDialog.tsx`
- Modify: `components/settings/DocumentDefaultsForm.tsx`
- Modify: `components/settings/DocumentProfileForm.tsx`
- Modify: `components/settings/LLMProviderForm.tsx`
- Modify: `components/settings/LLMSettingsDialog.tsx`
- Modify: `components/settings/LLMSettingsForm.tsx`
- Modify: `components/settings/OpenRouterModelPicker.tsx`
- Modify: `test/settings-page.test.tsx`
- Modify: `test/settings-dialogs.test.tsx`
- Modify: `test/openrouter-model-picker.test.tsx`

**Interfaces:** preserve all settings API functions, dirty callbacks, save callbacks, provider values, and model-picker listbox behavior.

- [ ] **Step 1: Add failing grouped-form tests**

Assert persistent labels, helper/error association, grouped section headings, visible dirty/save state, disabled pending controls, dialog focus behavior, listbox semantics, and readable long model names/prices.

- [ ] **Step 2: Run targeted settings tests and confirm failure for new presentation assertions**

Run:

```bash
npm test -- --run test/settings-page.test.tsx test/settings-dialogs.test.tsx test/openrouter-model-picker.test.tsx
```

- [ ] **Step 3: Normalize form layout and feedback**

Use 16px grouped panels only where fields share one responsibility. Keep 12px fields, visible labels, concise Vietnamese help, one primary save action per form, and persistent inline errors. Remove undefined `text-nav` usage from the model picker.

- [ ] **Step 4: Preserve dirty and async behavior**

Do not change request payloads, initial loading, saved values, or callback timing. A failed save keeps edits in place and exposes retry. Prevent duplicate save submissions.

- [ ] **Step 5: Run targeted verification**

Run:

```bash
npm test -- --run test/settings-page.test.tsx test/settings-dialogs.test.tsx test/openrouter-model-picker.test.tsx
npm run typecheck
```

Acceptance gate: settings are easier to scan while persistence, validation, and listbox behavior remain unchanged.

---

### Task 11: Unify authentication, public, loading, and error pages

**Files:**

- Modify: `app/page.tsx`
- Modify: `app/(auth)/layout.tsx`
- Modify: `app/(auth)/login/page.tsx`
- Modify: `app/(auth)/signup/page.tsx`
- Modify: `components/auth/AuthForm.tsx`
- Modify: `components/auth/PasswordField.tsx`
- Modify: `app/loading.tsx`
- Modify: `app/error.tsx`
- Modify: `app/not-found.tsx`
- Modify: `test/landing-page.test.tsx`
- Modify: `test/auth-pages.test.tsx`

**Interfaces:** preserve login/signup validation, autocomplete, redirect destinations, password visibility, session handling, and recovery actions.

- [ ] **Step 1: Add failing typography and composition tests**

Assert Be Vietnam token utilities, one primary public action, one compact header, no 11px text, no raw blue glow, no `text-display-xl`, one auth heading, persistent field labels, 44px password toggle, and Vietnamese system recovery copy.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run:

```bash
npm test -- --run test/landing-page.test.tsx test/auth-pages.test.tsx
```

- [ ] **Step 3: Recompose the public landing page**

Use an editorial but product-grounded hero, one primary action, a borderless secondary learning link, and real DocAI workflow proof. Remove browser-like decoration, fake metrics, tiny labels, gradient glow, and unsupported claims.

- [ ] **Step 4: Recompose authentication**

Use one compact 16px-radius panel, clear title and explanation, persistent labels, current validation, and existing navigation between login and signup. Maintain all autocomplete and pending behavior.

- [ ] **Step 5: Normalize system states**

Apply the shared typography and surfaces to loading, route error, and not-found pages. Every error includes a specific retry, return, or navigation action.

- [ ] **Step 6: Run targeted verification**

Run:

```bash
npm test -- --run test/landing-page.test.tsx test/auth-pages.test.tsx test/auth-provider.test.tsx test/smoke.test.tsx
npm run typecheck
```

Acceptance gate: public and auth pages feel related to the workspace without copying its sidebar topology, and existing session behavior remains intact.

---

### Task 12: Harden accessibility, localization, overflow, and responsive behavior

**Files:**

- Modify: only source and test files with a demonstrated failure from this task's audit.
- Modify: `test/design-system.test.ts`
- Modify: `test/app-shell.test.tsx`
- Modify: affected route tests.

**Interfaces:** no public interface changes unless required to supply an accessible name or pending state already specified above.

- [ ] **Step 1: Scan for copy, type, and styling violations**

Run:

```bash
rg -n "text-\[(?:[0-9]|1[0-2])px\]|Google Sans|Plus Jakarta|Playfair|text-product-title|text-display-xl|text-nav|shadow-glow|shadow-\[|italic|aria-label=\"[A-Za-z]" app components
node .agents/skills/impeccable/scripts/detect.mjs --json . 2>/dev/null || echo 'Design detector not available, skipping.'
```

Expected: every match is classified as valid technical content or repaired in a focused patch.

- [ ] **Step 2: Add regression assertions for each demonstrated defect**

For each defect, add the smallest source or component assertion that would fail before the fix and pass after it. Do not add broad snapshots.

- [ ] **Step 3: Repair keyboard and semantic issues**

Verify heading order, landmark names, form labels, dialog names/descriptions, focus order, focus restoration, live announcements, disabled/pending states, and non-color status cues on every route.

- [ ] **Step 4: Repair responsive overflow**

Check 360px, 768px, 1024px, and 1440px layouts. Toolbars wrap intentionally, mobile document rows include labels, dialogs fit within `100dvh`, long Vietnamese titles wrap, and no route causes horizontal page scrolling.

- [ ] **Step 5: Repair theme and motion differences**

Ensure both themes preserve layout and meaning. Under reduced motion, remove nonessential transitions and pulsing while keeping progress text and state changes visible.

- [ ] **Step 6: Run the full automated suite**

Run:

```bash
npm test -- --run
npm run lint
npm run typecheck
node .agents/skills/impeccable/scripts/detect.mjs --json . 2>/dev/null || echo 'Design detector not available, skipping.'
```

Acceptance gate: all commands pass, or any detector item is documented as an intentional value with file and reason in the handoff log.

---

### Task 13: Production build and bounded visual polish

**Files:**

- Modify: only files associated with defects found in the bounded visual review.
- Create during execution: `.artifacts/redesign/` screenshots and a short `qa-notes.md` if the directory does not already exist.

**Interfaces:** no new features or product contracts in this task.

- [x] **Step 1: Run final nonvisual verification**

Run:

```bash
npm test -- --run
npm run lint
npm run typecheck
npm run build
node .agents/skills/impeccable/scripts/detect.mjs --json . 2>/dev/null || echo 'Design detector not available, skipping.'
git diff --check
```

Expected: all commands exit zero and the detector has no unexplained findings.

- [x] **Step 2: Start the local app safely**

Run the existing development command on an available localhost port. Use a legitimate authenticated test session for protected routes. If authentication is unavailable, mark protected-route visual QA blocked; do not weaken route protection.

- [x] **Step 3: Capture one batched visual review**

Capture light and dark screenshots for:

- Desktop 1440px: dashboard, documents, open document detail, generation setup/review, templates, Q&A, settings, login, landing, and an error state.
- Mobile 390px: sidebar drawer, documents, generation, templates, Q&A, settings dialog, login, and landing.
- One 200% zoom sample of Documents and Generation.

Wait for `document.fonts.ready` before capture and confirm the computed UI family resolves to the hashed Be Vietnam Pro font generated by Next.

- [x] **Step 4: Perform one batched defect repair**

Compare against the design spec and references. Repair all observed issues in one patch batch: hierarchy, excessive rounding, nested borders, clipped Vietnamese text, inconsistent spacing, broken focus, poor contrast, unsupported content, theme drift, or responsive overflow. Do not add new features during polish.

- [x] **Step 5: Perform one confirmation pass**

Repeat screenshots only for repaired surfaces at desktop and mobile. Stop after this pass unless a functional or accessibility defect remains.

- [x] **Step 6: Run final verification again**

Run:

```bash
npm test -- --run
npm run lint
npm run typecheck
npm run build
node .agents/skills/impeccable/scripts/detect.mjs --json . 2>/dev/null || echo 'Design detector not available, skipping.'
git diff --check
```

- [x] **Step 7: Complete the handoff**

Update every ledger row, list screenshots and verification evidence, record any authenticated QA limitation, and provide the user a concise summary of implemented surfaces and remaining external blockers.

Acceptance gate closure: all 14 tasks are complete and no task remains `in_progress`. The authenticated/public Chrome audit, bounded repair, confirmation pass, and automated gate pass. Screenshot images were shown inline; no local PNG paths are claimed because DevTools rejected repository screenshot writes.

---

## Final acceptance checklist

Verified by automated evidence on 2026-08-09 unless marked otherwise.

- [x] `DESIGN.md` and the authoritative spec describe the same visual system.
- [x] Be Vietnam Pro is the only application UI family; Chrome computes the generated Be Vietnam Pro face on authenticated and public routes.
- [x] No undefined type utility, 11px UI text, legacy Google font, or decorative glow remains.
- [x] The desktop shell uses a 256px sidebar and one 24px-radius workspace.
- [x] Mobile uses a 52px header and accessible drawer.
- [x] `/documents` uses only real `DocumentListItem` fields and supports debounce, clear filters, stable fetching, pagination, and row-level busy state.
- [x] Document trust and export language never overstate validation or compliance.
- [x] Generation exposes setup, compose, review, and export stages without changing SSE behavior.
- [x] Templates preserve every real lifecycle state and safe deletion behavior.
- [x] Q&A keeps answer and sources distinct and preserves cancellation.
- [x] Dashboard contains no fabricated metrics or recent activity.
- [x] Settings preserve payloads, dirty state, async behavior, and model-picker semantics.
- [x] Public, auth, loading, error, and not-found pages use the same design foundation.
- [x] Vietnamese copy, long text, keyboard use, reduced motion, dark mode, and 200%-equivalent reflow were verified through tests and Chrome.
- [x] Tests, lint, typecheck, production build, Impeccable detector, and `git diff --check` pass. *(Detector result: `[]`; diff check emitted line-ending notices only.)*
- [x] Progress ledger and final handoff contain sufficient evidence for a new agent to verify completion without this conversation.

**Closed limitations:**

1. The legitimate QA account has no documents, so a populated detail modal was not represented with fabricated data; the modal retains its automated coverage.
2. Screenshots were delivered inline, but no local PNG artifact is claimed because Chrome DevTools rejected repository screenshot paths.
3. The `/settings` signup defect is fixed: successful signup now routes to `/dashboard`, with a regression assertion.
