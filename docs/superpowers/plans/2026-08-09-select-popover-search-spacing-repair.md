# Select Popover and Search Spacing Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every LLM settings overlay visible above its modal and restore clear spacing between the document-search icon and placeholder text.

**Architecture:** Add one semantic popover layer between modal and toast layers, then apply it to both shared Select and the OpenRouter model popover. Add one semantic leading-icon field modifier after the base control rule so the cascade preserves 40px inline-start padding without `!important`.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 3, Radix Select/Popover/Dialog, Vitest, Testing Library, Chrome DevTools.

## Global Constraints

- Preserve the Rounded Civic Workspace visual language and all existing provider/search behavior.
- Layer order is exact: backdrop/modal `1000`, popover `1050`, toast `1100`, tooltip `1200`.
- Search leading-icon clearance is `padding-inline-start: 40px`.
- Do not use `!important`, arbitrary z-index literals, inline style workarounds, or duplicate local padding rules.
- Keep Vietnamese copy, Be Vietnam Pro, 44px controls, keyboard behavior, and light/dark structure unchanged.
- The worktree already contains uncommitted redesign work in shared frontend files. Preserve it and do not create an implementation commit that would absorb unrelated changes.

---

### Task 1: Give portalled settings overlays a semantic layer

**Files:**
- Modify: `frontend/test/ui-primitives.test.tsx`
- Modify: `frontend/test/design-system.test.ts`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/tailwind.config.js`
- Modify: `frontend/components/ui/select.tsx`
- Modify: `frontend/components/settings/OpenRouterModelPicker.tsx`

**Interfaces:**
- Produces: CSS variable `--z-popover: 1050` and Tailwind utility `z-popover`.
- Consumes: existing Radix portals and design-system z-index variables.

- [ ] **Step 1: Add failing primitive and token assertions**

Import `Select` in `test/ui-primitives.test.tsx` and add:

```tsx
it('keeps portalled selection menus above modal content', async () => {
  const user = userEvent.setup();
  render(
    <Select
      ariaLabel="Nhà cung cấp"
      value="openrouter"
      onValueChange={vi.fn()}
      options={[
        { value: 'openrouter', label: 'OpenRouter' },
        { value: 'openai', label: 'OpenAI' },
      ]}
    />,
  );

  await user.click(screen.getByRole('combobox', { name: 'Nhà cung cấp' }));
  expect(screen.getByRole('listbox')).toHaveClass('z-popover');
  expect(screen.getByRole('option', { name: 'OpenAI' })).toBeVisible();
});
```

In `test/design-system.test.ts`, add a focused source-contract test:

```ts
it('keeps portalled controls above modal content and below notifications', () => {
  const css = readProjectFile('app/globals.css');
  const config = readProjectFile('tailwind.config.js');
  const selectSource = readProjectFile('components/ui/select.tsx');
  const modelPickerSource = readProjectFile('components/settings/OpenRouterModelPicker.tsx');

  expect(css).toContain('--z-popover: 1050');
  expect(config).toContain("popover: 'var(--z-popover)'");
  expect(selectSource).toContain('z-popover');
  expect(modelPickerSource).toContain('z-popover');
});
```

- [ ] **Step 2: Run the focused tests and confirm the intended failure**

Run:

```powershell
npm test -- --run test/ui-primitives.test.tsx test/design-system.test.ts
```

Expected: FAIL because `--z-popover`, the Tailwind alias, and `z-popover` classes do not exist.

- [ ] **Step 3: Add the layer token and apply it to both settings overlays**

In `app/globals.css`, insert the token in the existing layering block:

```css
--z-backdrop: 1000;
--z-modal: 1000;
--z-popover: 1050;
--z-toast: 1100;
```

In `tailwind.config.js`, add:

```js
popover: 'var(--z-popover)',
```

Replace the portalled content layer in `components/ui/select.tsx`:

```tsx
className="z-popover min-w-[var(--radix-select-trigger-width)] ..."
```

Replace `z-dropdown` with `z-popover` on the portalled Radix content in `components/settings/OpenRouterModelPicker.tsx`.

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run:

```powershell
npm test -- --run test/ui-primitives.test.tsx test/design-system.test.ts test/settings-dialogs.test.tsx
```

Expected: all selected files pass; provider and model-picker interaction tests remain green.

- [ ] **Step 5: Record the task checkpoint without committing dirty shared files**

Run `git diff --check` for the six Task 1 paths and record the passing result in the final handoff. Do not commit these already-dirty shared files separately.

---

### Task 2: Preserve leading-icon search clearance

**Files:**
- Modify: `frontend/test/documents-page.test.tsx`
- Modify: `frontend/test/design-system.test.ts`
- Modify: `frontend/app/globals.css`
- Modify: `frontend/components/documents/DocumentsToolbar.tsx`

**Interfaces:**
- Produces: semantic class `.control-field-leading-icon` with `padding-inline-start: 40px`.
- Consumes: existing `.control-field`, absolute search icon, and document search behavior.

- [ ] **Step 1: Add failing field and CSS assertions**

Add to `test/documents-page.test.tsx`:

```tsx
it('keeps search text clear of its leading icon', async () => {
  renderPage(await loadPage());
  const search = screen.getByRole('searchbox', { name: 'Tìm kiếm tài liệu' });

  expect(search).toHaveClass('control-field-leading-icon');
  expect(search).not.toHaveClass('pl-10');
});
```

Add a focused CSS assertion to `test/design-system.test.ts`:

```ts
it('reserves semantic inline space for leading field icons', () => {
  const css = readProjectFile('app/globals.css');
  expect(css).toMatch(/\.control-field-leading-icon\s*\{[^}]*padding-inline-start:\s*40px/s);
});
```

- [ ] **Step 2: Run the focused tests and confirm the intended failure**

Run:

```powershell
npm test -- --run test/documents-page.test.tsx test/design-system.test.ts
```

Expected: FAIL because the modifier is absent and the input still uses `pl-10`.

- [ ] **Step 3: Add and use the semantic modifier**

Immediately after `.control-field` in `app/globals.css`, add:

```css
.control-field-leading-icon {
  padding-inline-start: 40px;
}
```

Update the document search input:

```tsx
className="control-field control-field-leading-icon rounded-pill text-control"
```

- [ ] **Step 4: Run the focused tests and confirm they pass**

Run:

```powershell
npm test -- --run test/documents-page.test.tsx test/design-system.test.ts
```

Expected: both files pass with debounce, filter, form-name, and layout assertions unchanged.

- [ ] **Step 5: Record the task checkpoint without committing dirty shared files**

Run `git diff --check` for the four Task 2 paths and record the passing result in the final handoff. Do not commit these already-dirty shared files separately.

---

### Task 3: Browser confirmation and final verification

**Files:**
- Modify only if Chrome reveals a defect directly caused by Tasks 1–2.

**Interfaces:**
- Consumes: completed semantic layer and field modifier.
- Produces: verified desktop/mobile light/dark behavior and final command evidence.

- [ ] **Step 1: Run the full automated gate**

Run from `frontend`:

```powershell
npm test -- --run
npm run lint
npm run build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 2: Run the Impeccable detector once**

Run:

```powershell
node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json components/ui/select.tsx components/settings/OpenRouterModelPicker.tsx components/documents/DocumentsToolbar.tsx app/globals.css tailwind.config.js
```

Expected: no unexplained findings. Do not rerun the detector during this task.

- [ ] **Step 3: Confirm the LLM provider interaction in Chrome**

At desktop and 390px mobile, in light and dark modes:

1. Open `Cài đặt LLM`.
2. Open `Nhà cung cấp`.
3. Confirm OpenRouter, OpenAI, LM Studio, Ollama, and Tùy chỉnh render above the modal.
4. Select a non-current provider, confirm the trigger updates, then close without saving and discard the deliberate change.
5. Confirm keyboard Arrow keys, Enter, and Escape work and focus returns correctly.

- [ ] **Step 4: Confirm document-search spacing in Chrome**

At desktop and 390px mobile, in light and dark modes:

1. Open `/documents`.
2. Confirm the icon is fully separated from `Tìm kiếm tài liệu`.
3. Measure the input height as at least 44px and confirm no horizontal overflow.
4. Type into search and confirm the text never crosses the icon.

- [ ] **Step 5: Complete the handoff**

Report the root causes, exact files changed, targeted red/green evidence, full gate results, detector output, and Chrome observations. Preserve unrelated worktree changes and stop only services started specifically for this verification.
