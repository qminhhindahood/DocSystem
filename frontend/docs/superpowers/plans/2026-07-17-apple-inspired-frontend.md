# Apple-Inspired Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every public and authenticated DocAI surface in the approved Apple-inspired design language while preserving workflows, accessibility, and the light/dark theme toggle.

**Architecture:** Migrate token-first: semantic CSS variables and Tailwind aliases establish the contract, shared primitives enforce it, then shells and routes adopt those primitives. Keep `next-themes`, Radix, Monaco, routing, data fetching, and API behavior intact; remove legacy glass/glow/gradient APIs only after all consumers move.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.9, Tailwind CSS 3.4, Radix UI, next-themes, Monaco Editor, Vitest, Testing Library.

## Global Constraints

- The approved spec at `docs/superpowers/specs/2026-07-17-apple-inspired-frontend-design.md` overrides the root `DESIGN.md` when product context or accessibility conflicts.
- Preserve every route, request payload, auth/session behavior, document workflow, and settings behavior.
- Preserve the light/dark theme toggle and identical layout/meaning across themes.
- Target WCAG 2.2 AA, keyboard access, visible focus, reduced motion/transparency, and 44px primary mobile targets.
- Use the normative Apple-neutral token contract from the spec; no shared Tailwind Slate, Gray, Indigo, or Purple palette values.
- Use `.surface-vibrant` only on the public header, authenticated header, portal menus/popovers, and floating StreamingDocumentEditor toolbar.
- Remove decorative gradients, glows, floating orbs, background grids, decorative page-load motion, and legacy `glass-*` APIs.
- Do not introduce Apple logos, proprietary font files, new generated imagery, backend changes, or new product capabilities.

---

### Task 1: Establish the semantic theme, fonts, and design-contract tests

**Files:**
- Create: `test/design-system.test.ts`
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`
- Modify: `tailwind.config.js`

**Interfaces:**
- Produces CSS variables `--font-display`, `--font-text`, `--font-mono`, `--color-*`, `--radius-*`, `--duration-*`, and `--z-*` consumed by every later task.
- Produces Tailwind aliases `canvas`, `canvas-subtle`, `surface-raised`, `surface-strong`, `editor`, `text-primary`, `text-secondary`, `text-tertiary`, `action`, `action-hover`, `link`, `hairline`, and semantic state colors.
- Produces named typography utilities `text-display-hero`, `text-display-xl`, `text-display-lg`, `text-product-title`, `text-product-heading`, `text-body-reading`, `text-body-ui`, `text-caption`, and `text-nav`.

- [ ] **Step 1: Write the failing contract test**

Create a filesystem-level Vitest test that reads `app/globals.css` and `tailwind.config.js`, asserts the normative light/dark tokens, font stacks, reduced-transparency fallback, and named typography aliases, and rejects `.glass-panel`, `shadow-glow`, purple tokens, `bg-grid-pattern`, and `floatOrb`.

- [ ] **Step 2: Run the contract test and verify red**

Run: `npm test -- --run test/design-system.test.ts`

Expected: FAIL because the semantic token contract and cleanup are not present.

- [ ] **Step 3: Implement the semantic foundation**

Use `Inter` from `next/font/google` with `variable: '--font-inter'` in `app/layout.tsx`. Replace `app/globals.css` with the normative light/dark variables, base typography, semantic panels/controls, `.surface-vibrant`, accessible focus, reduced-motion/transparency, selection, skeleton, document-sheet, and Monaco/diff tokens. Map Tailwind colors, radii, shadows, font families, font sizes, motion, and z-index to those variables.

- [ ] **Step 4: Run focused and baseline verification**

Run: `npm test -- --run test/design-system.test.ts`

Expected: PASS.

Run: `npm test -- --run`

Expected: 92 existing tests plus the new design-contract tests pass.

---

### Task 2: Rebuild shared primitives and their state contracts

**Files:**
- Create: `test/ui-primitives.test.tsx`
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/textarea.tsx`
- Modify: `components/ui/select.tsx`
- Modify: `components/ui/badge.tsx`
- Modify: `components/ui/toast.tsx`

**Interfaces:**
- `Button` variants: `primary | secondary | link | ghost | destructive | icon`; existing call sites using `default` remain supported as an alias during the migration and are removed or normalized before cleanup.
- `Card` variants: `flat | outlined | elevated | public`.
- Inputs accept existing props and add optional `error`/helper semantics without changing consumer behavior.
- Select portal uses an allowed vibrant surface with an opaque fallback.

- [ ] **Step 1: Write failing primitive tests**

Test accessible button names and disabled state, capsule geometry on CTA variants, conventional geometry on ghost/icon controls, input error association, select trigger roles, badge text semantics, and toast live-region roles. Avoid snapshots of entire class strings.

- [ ] **Step 2: Verify red**

Run: `npm test -- --run test/ui-primitives.test.tsx`

Expected: FAIL because the new variant/state contract does not exist.

- [ ] **Step 3: Implement primitive variants**

Replace glass and glow classes with semantic tokens. Ensure every interactive primitive has default, hover, focus-visible, active, disabled, and loading-compatible styling. Primary/secondary CTAs have at least 44px height and pill geometry; dense controls use `rounded-control`. Cards are opaque and never pair a wide shadow with a border.

- [ ] **Step 4: Verify green and regression suite**

Run: `npm test -- --run test/ui-primitives.test.tsx test/smoke.test.tsx test/auth-pages.test.tsx test/dialogs.test.tsx`

Expected: PASS.

---

### Task 3: Migrate the app shell, theme controls, and global route states

**Files:**
- Modify: `components/layout/AppShell.tsx`
- Modify: `components/layout/Header.tsx`
- Modify: `components/layout/Sidebar.tsx`
- Modify: `components/providers/ThemeProvider.tsx`
- Modify: `lib/theme.ts`
- Modify: `app/loading.tsx`
- Modify: `app/error.tsx`
- Modify: `app/not-found.tsx`
- Modify: `test/app-shell.test.tsx`

**Interfaces:**
- Keep current navigation links, mobile drawer behavior, theme-toggle accessible name, settings triggers, logout, and skip links.
- Desktop sidebar width: 224–232px, opaque `canvas-subtle`, borderless and shadowless.
- Authenticated header: 52px, `.surface-vibrant`, semantic sticky z-index.

- [ ] **Step 1: Add failing shell tests**

Extend `test/app-shell.test.tsx` to assert the sidebar/navigation landmarks, mobile menu semantics, theme toggle, and absence of decorative class APIs in rendered shell markup. Add assertions that loading/error/not-found expose appropriate roles and actions.

- [ ] **Step 2: Verify red**

Run: `npm test -- --run test/app-shell.test.tsx`

Expected: FAIL on the new structural/style-semantic assertions.

- [ ] **Step 3: Implement shell and global states**

Restyle the shell, selected navigation, header controls, drawer overlay, skeleton loading, route error, and not-found page. Preserve `next-themes` configuration and ensure initial theme hydration remains safe.

- [ ] **Step 4: Verify green**

Run: `npm test -- --run test/app-shell.test.tsx test/auth-provider.test.tsx`

Expected: PASS.

---

### Task 4: Rebuild landing and authentication surfaces

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/(auth)/layout.tsx`
- Modify: `components/auth/AuthForm.tsx`
- Modify: `components/auth/PasswordField.tsx`
- Modify: `test/auth-pages.test.tsx`
- Create: `test/landing-page.test.tsx`

**Interfaces:**
- Public header remains single-row, 44–52px, with brand, theme toggle, and account actions.
- Hero communicates input, output, and trust, using one dominant live HTML document/workflow composition.
- Auth forms keep existing submit, validation, redirect, error, pending, and cross-link behavior.

- [ ] **Step 1: Write failing landing/auth structure tests**

Test that the landing page has one banner/header, a solid two-line-or-less hero, primary CTA, link-chevron CTA, real document-workflow text, and no gradient/glow/grid class APIs. Extend auth tests for a public-home link and accessible form-error placement.

- [ ] **Step 2: Verify red**

Run: `npm test -- --run test/landing-page.test.tsx test/auth-pages.test.tsx`

Expected: FAIL on the new editorial structure and removal of decorative styling.

- [ ] **Step 3: Implement public editorial composition**

Build the compact vibrant header, document-first hero, generation section, citation/evidence section, compliance/template section, closing CTA, and quiet footer. Use asymmetric live HTML compositions, square editorial canvases, named typography, restrained semantic color, and responsive rearrangement rather than decorative images or three equal cards.

- [ ] **Step 4: Implement authentication styling**

Create a focused responsive auth composition with one opaque form surface, clear Vietnamese hierarchy, public-home link, accessible errors, and matching light/dark semantics.

- [ ] **Step 5: Verify green**

Run: `npm test -- --run test/landing-page.test.tsx test/auth-pages.test.tsx`

Expected: PASS.

---

### Task 5: Migrate dashboard and document library

**Files:**
- Modify: `app/(app)/dashboard/page.tsx`
- Modify: `app/(app)/documents/page.tsx`
- Modify: `components/DocumentCard.tsx`
- Modify: `components/DocumentDetailModal.tsx`
- Modify: `test/documents-page.test.tsx`
- Create: `test/dashboard-page.test.tsx`
- Modify: `test/dialogs.test.tsx`

**Interfaces:**
- Dashboard uses one dominant next-action module plus supporting actions; it does not invent recent-data APIs.
- Documents retain fetch, filters, pagination, detail loading, retry/error, export, and empty behavior.
- Dialogs use opaque shared geometry and existing Radix focus behavior.

- [ ] **Step 1: Add failing page tests**

Test dashboard task hierarchy and route links. Test document search/filter labels, semantic error/empty states, pagination, and dialog accessible title/action behavior under the new structure.

- [ ] **Step 2: Verify red**

Run: `npm test -- --run test/dashboard-page.test.tsx test/documents-page.test.tsx test/dialogs.test.tsx`

Expected: FAIL on the new page hierarchy.

- [ ] **Step 3: Implement dashboard and documents redesign**

Create the asymmetric dashboard, quiet documents toolbar/list, semantic states, and common dialog styling without altering requests or navigation.

- [ ] **Step 4: Verify green**

Run the same focused command and expect PASS.

---

### Task 6: Rebuild the generation workbench and theme-aware editors

**Files:**
- Modify: `app/(app)/generate/page.tsx`
- Modify: `components/DocumentEditor.tsx`
- Modify: `components/StreamingDocumentEditor.tsx`
- Modify: `components/DocumentDiffViewer.tsx`
- Modify: `components/feature/FeedbackPanel.tsx`
- Modify: `components/feature/FidelityWarningPanel.tsx`
- Modify: `components/feature/SourcePanel.tsx`
- Modify: `components/feature/TemplateGallery.tsx`
- Modify: `components/feature/TemplatePreviewModal.tsx`
- Modify: `components/feature/ValidationPanel.tsx`
- Create: `test/editor-theme.test.tsx`
- Modify: `test/fidelity-warnings.test.tsx`

**Interfaces:**
- `DocumentEditor` and `DocumentDiffViewer` continue accepting optional explicit `theme`; when omitted, consumers pass the current application theme.
- Generation request, SSE handling, template selection, source upload, validation, feedback, accept/reject, and download behavior remain unchanged.
- Floating editor toolbar is the only editor element allowed to use `.surface-vibrant`.

- [ ] **Step 1: Write failing editor-theme tests**

Mock Monaco and assert application light/dark selection maps to `vs`/`vs-dark`; assert generation editor consumers no longer hard-code light. Extend fidelity tests for text-supported semantic states.

- [ ] **Step 2: Verify red**

Run: `npm test -- --run test/editor-theme.test.tsx test/fidelity-warnings.test.tsx`

Expected: FAIL because the streaming editor hard-codes light and legacy chrome remains.

- [ ] **Step 3: Implement the workbench migration**

Recompose the page into supporting controls/source context and a dominant document pane. Restyle editor/diff chrome, progress, validation, fidelity, source evidence, template selection, preview, and feedback with opaque semantic panels and accessible state treatments.

- [ ] **Step 4: Verify green and generation regressions**

Run focused tests, then `npm test -- --run`.

Expected: PASS.

---

### Task 7: Migrate Q&A, templates, settings, and all remaining dialogs

**Files:**
- Modify: `app/(app)/qa/page.tsx`
- Modify: `app/(app)/templates/page.tsx`
- Modify: `components/templates/TemplateStatusCard.tsx`
- Modify: `components/templates/TemplateUploadDialog.tsx`
- Modify: `components/templates/TemplateMappingReview.tsx`
- Modify: `components/TemplatePreviewModal.tsx`
- Modify: `components/settings/DocumentDefaultsDialog.tsx`
- Modify: `components/settings/DocumentDefaultsForm.tsx`
- Modify: `components/settings/DocumentProfileForm.tsx`
- Modify: `components/settings/LLMProviderForm.tsx`
- Modify: `components/settings/LLMSettingsDialog.tsx`
- Modify: `components/settings/LLMSettingsForm.tsx`
- Modify: `test/templates-page.test.tsx`
- Modify: `test/settings-dialogs.test.tsx`
- Modify: `test/settings-page.test.tsx`

**Interfaces:**
- Q&A preserves SSE, copy, regenerate, clear, filter, source expansion, and low-confidence behavior.
- Templates preserve list/load/delete/upload/review/mapping/compatibility/fidelity behavior.
- Settings preserve loading, save/delete, dirty-form confirmation, and server-managed numbering behavior.

- [ ] **Step 1: Add failing semantic/structure assertions**

Extend existing tests for Vietnamese empty/error/status text, accessible dialog headings, status labels, and absence of legacy styling APIs in rendered feature roots.

- [ ] **Step 2: Verify red**

Run: `npm test -- --run test/templates-page.test.tsx test/settings-dialogs.test.tsx test/settings-page.test.tsx`

Expected: FAIL on the new semantic structure.

- [ ] **Step 3: Implement remaining feature migration**

Restyle the conversation transcript/composer/evidence, template list/status/review/upload, and settings forms/dialogs. Use semantic panels, consistent field rhythm, text-supported status, and shared dialog geometry.

- [ ] **Step 4: Verify green**

Run focused tests, then full suite.

Expected: PASS.

---

### Task 8: Remove legacy APIs and verify the entire frontend

**Files:**
- Modify: any consumer reported by the cleanup scans below.
- Modify: `test/design-system.test.ts`

**Interfaces:**
- No `glass-panel`, `glass-input`, `bg-void`, `bg-glass`, `shadow-glow`, purple/indigo decorative palette, gradient-text, background-grid, floating-orb, or decorative page-load animation remains.
- `.surface-vibrant` exists only at the approved four categories of chrome.

- [ ] **Step 1: Run cleanup scans and let the contract test fail on any residue**

Run:

```powershell
rg -n "glass-|bg-void|bg-glass|shadow-glow|purple-|indigo-|bg-gradient|bg-clip-text|bg-grid-pattern|floatOrb|animate-float" app components tailwind.config.js
rg -n "surface-vibrant" app components
```

Expected: the first scan returns no matches; the second returns only approved header, portal, and floating-toolbar consumers.

- [ ] **Step 2: Remove every reported legacy consumer**

Replace residue with semantic aliases or shared primitives. Do not add compatibility aliases.

- [ ] **Step 3: Run automated verification**

Run: `npm test -- --run`

Expected: all tests pass with zero failures.

Run: `npm run lint`

Expected: exit 0 with zero warnings.

Run: `npm run build`

Expected: production build exits 0.

- [ ] **Step 4: Run visual verification**

Start the production or development server and inspect landing, login, dashboard, documents, generation, Q&A, templates, representative dialogs, and global states at 320px, 375px, 768px, 1024px, and 1440px in both themes. Verify no horizontal overflow, clipped dialogs, hidden focus, illegible muted text, or theme layout shift. Confirm the landing hero is document-dominant and not a repeated-card or browser-mockup composition.

- [ ] **Step 5: Review the final diff against the spec**

Run `git diff --check`, inspect `git diff --stat`, and map every acceptance criterion in the approved spec to an implemented task or verification result before claiming completion.
