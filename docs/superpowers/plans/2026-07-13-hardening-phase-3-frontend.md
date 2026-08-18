# Frontend Accounts, Templates, and Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete signup/login/logout/session/settings/template workflows and make generation/QA streaming, mobile navigation, dialogs, and confidence feedback reliable and accessible.

**Architecture:** Next route handlers own an HttpOnly user-session cookie and stream backend responses without exposing tokens. Route groups separate public account pages from the protected app shell. Typed client modules isolate auth, templates, settings, and SSE parsing; UI components consume those contracts and abort work on cancellation/unmount.

**Tech Stack:** Next.js 16.2.10, React/React DOM 19.2.7, TypeScript 5.9.3, Vitest 4.1.10, Testing Library 16.3.2, user-event 14.6.1, jsdom 29.1.1, Radix Dialog, Tailwind CSS.

## Global Constraints

- Before implementing visual tasks, invoke the `impeccable` skill and preserve the existing DocAI visual language unless the skill identifies an accessibility defect.
- Browser code never reads or stores the JWT; remove `setAuthToken`, `getAuthToken`, and every admin-token helper.
- Cookie name is `docai_session`; it is HttpOnly, `SameSite=Lax`, `Path=/`, and `Secure` outside development.
- Only same-origin paths beginning with one `/` are valid return targets; reject `//`, backslashes, absolute URLs, and encoded protocol-relative variants.
- Protected UI paths are `/`, `/generate`, `/documents`, `/qa`, `/templates`, and `/settings`.
- Auth pages are `/login` and `/signup`; `/signup` is labeled “Create account”.
- Every fetch that can outlive a component accepts an `AbortSignal` and suppresses state updates after abort.

---

### Task 1: Normalize Frontend Dependencies and Install a Real Test Harness

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Delete: `frontend/jest.config.*` if present
- Create: `frontend/vite.config.ts`
- Create: `frontend/test/setup.ts`
- Create: `frontend/test/smoke.test.tsx`
- Create: `frontend/eslint.config.mjs`

**Interfaces:**
- Produces: `npm test -- --run`, `npm run lint`, and React Testing Library environment.

- [ ] **Step 1: Replace mismatched Jest/Next dependencies and write a smoke test**

Run:

```powershell
npm install next@16.2.10 react@19.2.7 react-dom@19.2.7
npm install -D eslint@9.39.5 eslint-config-next@16.2.10 typescript@5.9.3 vitest@4.1.10 jsdom@29.1.1 @vitejs/plugin-react@6.0.3 @testing-library/react@16.3.2 @testing-library/user-event@14.6.1 @testing-library/jest-dom@6.9.1 @types/react@19.2.17 @types/react-dom@19.2.3
npm uninstall jest ts-jest @types/jest
```

Set scripts to `"test": "vitest"`, `"test:watch": "vitest"`, and retain `eslint . --max-warnings=0`. Add a smoke test rendering the existing `Button` and asserting its accessible name.

- [ ] **Step 2: Run test and lint to expose missing configuration**

Run: `cd frontend && npm test -- --run && npm run lint`

Expected before configuration: FAIL due missing jsdom/aliases or legacy ESLint configuration.

- [ ] **Step 3: Configure Vitest and flat ESLint**

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: { environment: 'jsdom', setupFiles: ['./test/setup.ts'], restoreMocks: true },
});
```

`test/setup.ts` imports `@testing-library/jest-dom/vitest` and resets DOM/mocks. `eslint.config.mjs` spreads the Next core-web-vitals and TypeScript flat configs and ignores `.next`, `coverage`, and `dist`.

- [ ] **Step 4: Run test, lint, and build**

Run: `cd frontend && npm test -- --run && npm run lint && npm run build`

Expected: PASS; at least one test is reported.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/test frontend/eslint.config.mjs
git commit -m "test: establish frontend Vitest coverage"
```

### Task 2: Implement HttpOnly Session Route Handlers and a Streaming Proxy

**Files:**
- Create: `frontend/lib/server/session.ts`
- Create: `frontend/lib/server/backend.ts`
- Create: `frontend/app/api/session/login/route.ts`
- Create: `frontend/app/api/session/signup/route.ts`
- Create: `frontend/app/api/session/logout/route.ts`
- Create: `frontend/app/api/session/me/route.ts`
- Modify: `frontend/app/api/proxy/[...path]/route.ts`
- Create: `frontend/test/session-routes.test.ts`
- Create: `frontend/test/proxy-route.test.ts`

**Interfaces:**
- Produces: `POST /api/session/login`, `POST /api/session/signup`, `POST /api/session/logout`, `GET /api/session/me`.
- Produces: `sessionCookieOptions()` and `normalizeReturnTo(value): string`.

- [ ] **Step 1: Write failing cookie, return-path, logout, and streaming tests**

Test login/signup strip backend `token` and set `docai_session`; invalid credentials preserve backend status without internal details; logout emits an expired cookie even when backend is unreachable; `/me` forwards the cookie as Bearer. Test `normalizeReturnTo` accepts `/documents?id=1` and returns `/` for `//evil.test`, `https://evil.test`, `/%2f%2fevil.test`, and `/\\evil.test`. Mock a `ReadableStream`, call the general proxy, enqueue the second chunk after the response is returned, and prove the handler did not call `arrayBuffer()`.

- [ ] **Step 2: Run tests and observe missing routes/buffering**

Run: `cd frontend && npm test -- --run test/session-routes.test.ts test/proxy-route.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement server-only session handling**

```ts
export const SESSION_COOKIE = 'docai_session';
export const sessionCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV !== 'development',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 7,
});

export function normalizeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return '/'; }
  return decoded.startsWith('/') && !decoded.startsWith('//') && !decoded.includes('\\') ? value : '/';
}
```

Session routes call only `BACKEND_API_URL/api/auth/login|register|me`, normalize errors, set/clear cookies, and never return the token. The general proxy deletes incoming `authorization`, `cookie`, and hop-by-hop headers, adds Authorization from the session cookie, blocks proxying `auth/login` and `auth/register`, and returns `new NextResponse(backendRes.body, ...)` directly. Forward `content-type`, `content-disposition`, cache, and request-ID headers; omit backend cookies.

- [ ] **Step 4: Rerun tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/server frontend/app/api/session frontend/app/api/proxy frontend/test/session-routes.test.ts frontend/test/proxy-route.test.ts
git commit -m "feat: add secure browser sessions and streaming proxy"
```

### Task 3: Protect Route Groups and Restore Sessions

**Files:**
- Create: `frontend/proxy.ts`
- Create: `frontend/components/auth/AuthProvider.tsx`
- Create: `frontend/components/auth/RequireSession.tsx`
- Create: `frontend/lib/auth.ts`
- Modify: `frontend/app/layout.tsx`
- Create: `frontend/app/(app)/layout.tsx`
- Create: `frontend/app/(auth)/layout.tsx`
- Move: `frontend/app/page.tsx` to `frontend/app/(app)/page.tsx`
- Move: `frontend/app/generate/page.tsx` to `frontend/app/(app)/generate/page.tsx`
- Move: `frontend/app/documents/page.tsx` to `frontend/app/(app)/documents/page.tsx`
- Move: `frontend/app/qa/page.tsx` to `frontend/app/(app)/qa/page.tsx`
- Create: `frontend/test/auth-provider.test.tsx`
- Create: `frontend/test/proxy.test.ts`

**Interfaces:**
- Produces: `useAuth(): { user, status, refresh, logout }` where status is `loading|authenticated|anonymous`.
- Produces: `normalizeClientReturnTo(value: string | null): string` using the same path-only rules as the server helper.

- [ ] **Step 1: Write failing redirect and bootstrap tests**

Assert anonymous protected requests redirect to `/login?returnTo=<encoded path>`, authenticated `/login` and `/signup` requests redirect to `/`, static/API paths are untouched, `AuthProvider` restores `/api/session/me`, 401 becomes anonymous, and logout clears UI state even if the route returns 502 after clearing its cookie.

- [ ] **Step 2: Run and observe failure**

Run: `cd frontend && npm test -- --run test/auth-provider.test.tsx test/proxy.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement route groups and session context**

Root layout contains metadata, theme script, and `AuthProvider` only. The `(app)` layout wraps children with `RequireSession` and `AppShell`; `(auth)` uses a centered account shell without sidebar/header. `frontend/proxy.ts` uses cookie presence for fast routing; `RequireSession` performs authoritative `/me` validation and redirects expired sessions.

```ts
export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
```

- [ ] **Step 4: Rerun tests and build**

Run: `cd frontend && npm test -- --run test/auth-provider.test.tsx test/proxy.test.ts && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/proxy.ts frontend/components/auth frontend/lib/auth.ts frontend/app/layout.tsx frontend/app/'(app)' frontend/app/'(auth)' frontend/app/page.tsx frontend/app/generate frontend/app/documents frontend/app/qa frontend/test/auth-provider.test.tsx frontend/test/proxy.test.ts
git commit -m "feat: protect application routes and restore sessions"
```

### Task 4: Build Create-Account and Login Pages

**Files:**
- Create: `frontend/app/(auth)/login/page.tsx`
- Create: `frontend/app/(auth)/signup/page.tsx`
- Create: `frontend/components/auth/AuthForm.tsx`
- Create: `frontend/components/auth/PasswordField.tsx`
- Create: `frontend/test/auth-pages.test.tsx`

**Interfaces:**
- Login body: `{ username: string; password: string; returnTo: string }`.
- Signup body: `{ username: string; password: string; passwordConfirmation: string }`.

- [ ] **Step 1: Invoke `impeccable` and write failing interaction/accessibility tests**

Test labels, autocomplete (`username`, `current-password`, `new-password`), password confirmation, username length 3–50, password length 8–100, mismatched passwords, duplicate 409 copy, invalid login copy, disabled submit/pending state, focus on first invalid field, safe return redirect, and no token in DOM/localStorage.

- [ ] **Step 2: Run tests and observe failure**

Run: `cd frontend && npm test -- --run test/auth-pages.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement shared accessible forms**

Use semantic `<form>`, explicit labels, `aria-describedby`, one `role="alert"` summary, and a show/hide password button with an accessible state name. Submit JSON to session routes. On success call `auth.refresh()` and `router.replace(normalizeClientReturnTo(...))`; signup defaults to `/settings` so the user can configure a model. Use “Create account” consistently in heading and submit text.

- [ ] **Step 4: Rerun tests, lint, and inspect at mobile/desktop widths**

Run: `cd frontend && npm test -- --run test/auth-pages.test.tsx && npm run lint`

Expected: PASS. During execution, use the browser skill to verify keyboard flow and 360px/1440px layouts against the impeccable review.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/'(auth)'/login frontend/app/'(auth)'/signup frontend/components/auth/AuthForm.tsx frontend/components/auth/PasswordField.tsx frontend/test/auth-pages.test.tsx
git commit -m "feat: add login and create-account pages"
```

### Task 5: Add User Provider and Model Settings

**Files:**
- Create: `frontend/app/(app)/settings/page.tsx`
- Create: `frontend/components/settings/LLMSettingsForm.tsx`
- Create: `frontend/components/settings/DocumentProfileForm.tsx`
- Create: `frontend/lib/settings-api.ts`
- Create: `frontend/test/settings-page.test.tsx`
- Modify: `frontend/components/layout/Sidebar.tsx`

**Interfaces:**
- `getLLMSettings(signal?)`, `saveLLMSettings(input, signal?)`, `testLLMSettings(input, signal?)`, and `deleteLLMSettings(signal?)` call `/api/proxy/settings/llm`.
- `getDocumentProfile(signal?)` and `saveDocumentProfile(input, signal?)` call `/api/proxy/settings/document-profile` and never accept `nextDocumentNumber` from the browser.

- [ ] **Step 1: Invoke `impeccable` and write failing settings tests**

Assert API keys are never populated from GET, blank key preserves the stored key, provider/base URL/model are required, test connection does not save, save gives a success state, delete requires Radix confirmation, 401 triggers session refresh, and unmount aborts pending test/save calls. For document defaults, test agency name/code, place, recipient chips, signatory name/title, document-number prefix, length limits, and that sequence state is read-only/server-owned.

- [ ] **Step 2: Run and observe failure**

Run: `cd frontend && npm test -- --run test/settings-page.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement typed API and form**

Use provider options `openai`, `openrouter`, `lmstudio`, `ollama`, and `custom`. Explain the operator allowlist for local URLs. Show the key field as write-only with “stored key unchanged” text. Add a separate document-defaults section used for deterministic agency, location, recipients, signatory, and numbering values. Add Settings to navigation and show the authenticated username plus logout action in the shell.

- [ ] **Step 4: Rerun tests/lint**

Run: `cd frontend && npm test -- --run test/settings-page.test.tsx && npm run lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/'(app)'/settings frontend/components/settings frontend/lib/settings-api.ts frontend/test/settings-page.test.tsx frontend/components/layout/Sidebar.tsx
git commit -m "feat: add private model and API settings"
```

### Task 6: Build Template Library, Upload, Analysis, and Mapping Review

**Files:**
- Create: `frontend/app/(app)/templates/page.tsx`
- Replace: `frontend/components/feature/TemplateGallery.tsx`
- Create: `frontend/components/templates/TemplateUploadDialog.tsx`
- Create: `frontend/components/templates/TemplateStatusCard.tsx`
- Create: `frontend/components/templates/TemplateMappingReview.tsx`
- Create: `frontend/lib/templates-api.ts`
- Create: `frontend/test/templates-page.test.tsx`
- Modify: `frontend/components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes Phase 2's typed `{ success, templates }` API through `/api/proxy/templates`.
- Produces selected `templateId` for generation; no component infers template choice from `docType`.

- [ ] **Step 1: Invoke `impeccable` and write failing workflow tests**

Test owner template listing, empty state, DOCX-only/20 MiB client checks, upload progress state, same-kind duplicates, `UPLOADED→ANALYZING→READY`, `NEEDS_REVIEW` preview/field mapping, `REJECTED` actionable reason, delete confirmation, another-owner 404, and selection by `template.id`. Assert API URL is `/api/proxy/templates`, not `/api/templates`.

- [ ] **Step 2: Run and observe failure**

Run: `cd frontend && npm test -- --run test/templates-page.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement template workflow**

Use a Radix upload dialog, native multipart `FormData`, status badges, and bounded status polling that stops at terminal states/unmount. Mapping review shows labeled page images beside required semantic roles, allows choosing only server-provided locator IDs, and saves the complete map in one PATCH. Display the fidelity guarantee only for `READY` templates.

- [ ] **Step 4: Rerun tests and browser-check mapping layout**

Run: `cd frontend && npm test -- --run test/templates-page.test.tsx && npm run lint`

Expected: PASS. Browser verification covers 360px, keyboard-only dialog/mapping use, and loading/error/empty states.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/'(app)'/templates frontend/components/feature/TemplateGallery.tsx frontend/components/templates frontend/lib/templates-api.ts frontend/test/templates-page.test.tsx frontend/components/layout/Sidebar.tsx
git commit -m "feat: add private DOCX template workflow"
```

### Task 7: Make Template-Based Generation and SSE Parsing Abort-Safe

**Files:**
- Create: `frontend/lib/sse.ts`
- Create: `frontend/lib/sse.test.ts`
- Refactor: `frontend/lib/api.ts`
- Delete: `frontend/app/admin/feedback/page.tsx`
- Modify: `frontend/app/(app)/generate/page.tsx`
- Modify: `frontend/app/(app)/qa/page.tsx`
- Modify: `frontend/components/StreamingDocumentEditor.tsx`
- Create: `frontend/test/generation-stream.test.tsx`
- Create: `frontend/test/qa-stream.test.tsx`

**Interfaces:**
- `parseSSE(stream: ReadableStream<Uint8Array>, signal?): AsyncGenerator<SSEEvent>` retains incomplete lines and flushes at EOF.
- `generateDocument(request, signal?)` requires `templateId`; `askQuestion(question, docType, signal?)` accepts cancellation.

- [ ] **Step 1: Write failing fragmented-stream and cancellation tests**

Split `data:` JSON across arbitrary byte chunks, combine multiple events in one chunk, use CRLF, comments, multiline data, final event without trailing blank line, malformed isolated event, and `[DONE]`. Assert abort cancels the reader and no stale React state is written after cancellation/unmount. Assert the editor reflects streamed parent content until the user begins editing, then preserves the user's edit. Assert QA sources are reset per request and low-confidence warning remains visible after completion.

- [ ] **Step 2: Run and observe current parser/cancellation failures**

Run: `cd frontend && npm test -- --run lib/sse.test.ts test/generation-stream.test.tsx test/qa-stream.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement one shared SSE parser and request-local state**

```ts
export interface SSEEvent { event?: string; data: unknown; id?: string; }

function decodeSSEFrame(frame: string): SSEEvent {
  const data: string[] = [];
  let event: string | undefined;
  let id: string | undefined;
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(value);
    if (field === 'event') event = value;
    if (field === 'id') id = value;
  }
  const raw = data.join('\n');
  if (raw === '[DONE]') return { event: 'done', data: null, id };
  try { return { event, data: JSON.parse(raw), id }; }
  catch { return { event: 'malformed', data: raw, id }; }
}

export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = done ? '' : frames.pop() ?? '';
      for (const frame of frames) yield decodeSSEFrame(frame);
      if (done) { if (buffer.trim()) yield decodeSSEFrame(buffer); break; }
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
```

Generation requires an explicitly selected `READY` template, creates one `AbortController` per request, and aborts prior work. Remove module-global auth token and all admin/review/training/model helpers/types from `api.ts`.

- [ ] **Step 4: Rerun stream tests, lint, and build**

Run: `cd frontend && npm test -- --run lib/sse.test.ts test/generation-stream.test.tsx test/qa-stream.test.tsx && npm run lint && npm run build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/lib/sse.ts frontend/lib/sse.test.ts frontend/lib/api.ts frontend/app/admin/feedback/page.tsx frontend/app/'(app)'/generate/page.tsx frontend/app/'(app)'/qa/page.tsx frontend/components/StreamingDocumentEditor.tsx frontend/test/generation-stream.test.tsx frontend/test/qa-stream.test.tsx
git commit -m "fix: stream generation and QA safely"
```

### Task 8: Fix Controlled Mobile Navigation and Accessible Dialogs

**Files:**
- Modify: `frontend/components/layout/AppShell.tsx`
- Modify: `frontend/components/layout/Header.tsx`
- Modify: `frontend/components/layout/Sidebar.tsx`
- Modify: `frontend/components/DocumentDetailModal.tsx`
- Modify: `frontend/components/feature/TemplatePreviewModal.tsx`
- Create: `frontend/test/app-shell.test.tsx`
- Create: `frontend/test/dialogs.test.tsx`

**Interfaces:**
- `SidebarProps = { open: boolean; onOpenChange(open: boolean): void }`.
- Every modal uses Radix `Dialog.Root`, `Dialog.Title`, and `Dialog.Description`.

- [ ] **Step 1: Invoke `impeccable` and write failing keyboard/mobile tests**

Assert header menu opens the actual sidebar, overlay/Escape/navigation closes it, focus returns to trigger, desktop sidebar remains visible, dialogs trap focus, have accessible title/description, close on Escape, restore focus, and do not allow background interaction.

- [ ] **Step 2: Run and observe disconnected state/custom-dialog failures**

Run: `cd frontend && npm test -- --run test/app-shell.test.tsx test/dialogs.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement controlled shell and Radix dialogs**

Make `AppShell` the only mobile-open state owner and pass it through Header/Sidebar. Use `aria-expanded`, `aria-controls`, and inert/overlay behavior from Radix. Preserve editor content and field values when preview dialogs open/close.

- [ ] **Step 4: Run the complete frontend gate**

Run: `cd frontend && npm test -- --run && npm run lint && npm run build && npm audit --audit-level=moderate`

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/layout frontend/components/DocumentDetailModal.tsx frontend/components/feature/TemplatePreviewModal.tsx frontend/test/app-shell.test.tsx frontend/test/dialogs.test.tsx
git commit -m "fix: make navigation and dialogs accessible"
```
