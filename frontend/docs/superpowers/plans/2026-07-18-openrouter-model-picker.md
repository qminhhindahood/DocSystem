# OpenRouter Model Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live, searchable OpenRouter model picker that displays developer recommendations first, prioritizes free models, and retains manual model-ID entry.

**Architecture:** The backend fetches and validates OpenRouter's public model catalog, enriches it with recommendation/free metadata, caches it for ten minutes, and exposes a bounded authenticated endpoint. The frontend loads that endpoint through the existing session proxy and renders a Radix popover combobox only for OpenRouter; all other providers keep the current text field.

**Tech Stack:** Express 4, TypeScript, Axios, Zod, Jest/Supertest, Next.js 16, React 19, Radix UI, Tailwind CSS, Vitest, Testing Library.

## Global Constraints

- Do not send, decrypt, forward, or log a user's OpenRouter API key while loading the catalog.
- Preserve the current save/test API contract and the selected `model` string.
- Keep light and dark themes structurally identical and use existing design tokens only.
- Keep Vietnamese labels, status text, and error messages throughout the picker.
- Preserve existing user changes in both the root repository and nested frontend repository; stage only named files.
- Do not use subagents unless the user explicitly requests them.
- Use TDD: observe each focused test fail before adding its implementation.

---

## File Map

### Backend (`C:/Users/PC/Documents/LLM` root repository)

- Create `backend/src/config/openrouter_models.ts`: default recommendations and environment parsing.
- Create `backend/src/services/openrouter_models.ts`: upstream validation, normalization, ordering, caching, search, and result limits.
- Create `backend/src/services/openrouter_models.test.ts`: pure behavior and upstream/cache tests.
- Modify `backend/src/routes/llm-settings.ts`: authenticated catalog endpoint.
- Modify `backend/src/routes/llm-settings.contract.test.ts`: route authentication, query, success, and failure contract.
- Modify `backend/.env.example`: recommendation override documentation.

### Frontend (`C:/Users/PC/Documents/LLM/frontend` nested repository)

- Modify `package.json` and `package-lock.json`: add `@radix-ui/react-popover`.
- Modify `lib/settings-api.ts`: normalized catalog types and fetch function.
- Create `components/settings/OpenRouterModelPicker.tsx`: searchable grouped picker and manual-entry mode.
- Create `test/openrouter-model-picker.test.tsx`: picker interaction/accessibility coverage.
- Modify `components/settings/LLMProviderForm.tsx`: render the picker only for OpenRouter.
- Modify `test/settings-dialogs.test.tsx`: integrate catalog selection with dirty/save behavior.

---

### Task 1: Backend recommendation configuration and catalog service

**Files:**
- Create: `../backend/src/config/openrouter_models.ts`
- Create: `../backend/src/services/openrouter_models.ts`
- Test: `../backend/src/services/openrouter_models.test.ts`
- Modify: `../backend/.env.example`

**Interfaces:**
- Produces: `getRecommendedOpenRouterModelIds(raw?: string): string[]`
- Produces: `OpenRouterModelSummary`
- Produces: `listOpenRouterModels(query?: string): Promise<{ models: OpenRouterModelSummary[]; total: number }>`
- Produces: `resetOpenRouterModelCacheForTests(): void`

- [ ] **Step 1: Write failing configuration and normalization tests**

Create tests that assert the exact public contract:

```ts
import axios from 'axios';
import { getRecommendedOpenRouterModelIds } from '../config/openrouter_models';
import {
  listOpenRouterModels,
  resetOpenRouterModelCacheForTests,
} from './openrouter_models';

jest.mock('axios');
const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

const upstream = {
  data: {
    data: [
      { id: 'paid/model', name: 'Paid Model', context_length: 32000, pricing: { prompt: '0.000001', completion: '0.000002' } },
      { id: 'free/model:free', name: 'Free Model', context_length: 64000, pricing: { prompt: '0', completion: '0' } },
      { id: 'openrouter/free', name: 'Free Models Router', context_length: 200000, pricing: { prompt: '0', completion: '0' } },
    ],
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  resetOpenRouterModelCacheForTests();
  delete process.env.OPENROUTER_RECOMMENDED_MODELS;
});

it('uses defaults only when the environment override is absent', () => {
  expect(getRecommendedOpenRouterModelIds(undefined)).toEqual(['openrouter/free']);
  expect(getRecommendedOpenRouterModelIds(' paid/model, free/model:free,paid/model '))
    .toEqual(['paid/model', 'free/model:free']);
  expect(getRecommendedOpenRouterModelIds('')).toEqual([]);
});

it('orders recommendations, then free models, then paid models', async () => {
  process.env.OPENROUTER_RECOMMENDED_MODELS = 'paid/model,openrouter/free';
  mockedGet.mockResolvedValue(upstream);
  const result = await listOpenRouterModels();
  expect(result.models.map((model) => model.id)).toEqual([
    'paid/model', 'openrouter/free', 'free/model:free',
  ]);
  expect(result.models[0]).toMatchObject({ recommended: true, free: false, promptPricePerMillion: 1 });
  expect(result.models[1]).toMatchObject({ recommended: true, free: true });
});

it('caches upstream data, filters search, and never sends an API key', async () => {
  mockedGet.mockResolvedValue(upstream);
  await listOpenRouterModels('free model');
  const second = await listOpenRouterModels('paid/model');
  expect(second.models.map((model) => model.id)).toEqual(['paid/model']);
  expect(mockedGet).toHaveBeenCalledTimes(1);
  expect(mockedGet).toHaveBeenCalledWith(
    'https://openrouter.ai/api/v1/models',
    expect.objectContaining({ params: { output_modalities: 'text' }, timeout: 8000 }),
  );
  expect(mockedGet.mock.calls[0][1]?.headers).toBeUndefined();
});

it('rejects malformed upstream responses', async () => {
  mockedGet.mockResolvedValue({ data: { data: [{ name: 'missing-id' }] } });
  await expect(listOpenRouterModels()).rejects.toThrow('Invalid OpenRouter model catalog');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm test -- src/services/openrouter_models.test.ts --runInBand
```

Expected: FAIL because the configuration and service modules do not exist.

- [ ] **Step 3: Implement recommendation parsing**

Create `backend/src/config/openrouter_models.ts` with these semantics:

```ts
export const DEFAULT_OPENROUTER_RECOMMENDED_MODELS = ['openrouter/free'] as const;

export function getRecommendedOpenRouterModelIds(
  raw: string | undefined = process.env.OPENROUTER_RECOMMENDED_MODELS,
): string[] {
  if (raw === undefined) return [...DEFAULT_OPENROUTER_RECOMMENDED_MODELS];
  return [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
}
```

- [ ] **Step 4: Implement the validated cached catalog service**

Create `backend/src/services/openrouter_models.ts` with:

```ts
import axios from 'axios';
import { z } from 'zod';
import { getRecommendedOpenRouterModelIds } from '../config/openrouter_models';

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 10 * 60 * 1000;
const RESULT_LIMIT = 80;
const PriceSchema = z.union([z.string(), z.number()]).optional();
const CatalogSchema = z.object({
  data: z.array(z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    context_length: z.number().nonnegative().nullable().optional(),
    pricing: z.object({ prompt: PriceSchema, completion: PriceSchema }).optional(),
  })),
});

type UpstreamModel = z.infer<typeof CatalogSchema>['data'][number];
export interface OpenRouterModelSummary {
  id: string;
  name: string;
  provider: string;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  free: boolean;
  recommended: boolean;
}

let cache: { expiresAt: number; models: UpstreamModel[] } | null = null;

function pricePerMillion(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null;
}

export function resetOpenRouterModelCacheForTests(): void { cache = null; }

async function loadCatalog(): Promise<UpstreamModel[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.models;
  const response = await axios.get(CATALOG_URL, {
    params: { output_modalities: 'text' },
    timeout: 8000,
  });
  const parsed = CatalogSchema.safeParse(response.data);
  if (!parsed.success) throw new Error('Invalid OpenRouter model catalog');
  cache = { models: parsed.data.data, expiresAt: Date.now() + CACHE_TTL_MS };
  return cache.models;
}

export async function listOpenRouterModels(query = ''): Promise<{
  models: OpenRouterModelSummary[];
  total: number;
}> {
  const upstream = await loadCatalog();
  const recommendedIds = getRecommendedOpenRouterModelIds();
  const recommendationRank = new Map(recommendedIds.map((id, index) => [id, index]));
  const available = new Set(upstream.map((model) => model.id));
  for (const id of recommendedIds) {
    if (!available.has(id)) console.warn(`[OpenRouter] Recommended model is unavailable: ${id}`);
  }
  const normalized = upstream.map((model) => {
    const prompt = pricePerMillion(model.pricing?.prompt);
    const completion = pricePerMillion(model.pricing?.completion);
    return {
      id: model.id,
      name: model.name || model.id,
      provider: model.id.split('/')[0] || 'openrouter',
      contextLength: model.context_length ?? null,
      promptPricePerMillion: prompt,
      completionPricePerMillion: completion,
      free: model.id.endsWith(':free') || (prompt === 0 && completion === 0),
      recommended: recommendationRank.has(model.id),
    } satisfies OpenRouterModelSummary;
  }).sort((left, right) => {
    const leftRank = recommendationRank.get(left.id);
    const rightRank = recommendationRank.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    if (left.free !== right.free) return left.free ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle
    ? normalized.filter((model) => `${model.name} ${model.id} ${model.provider}`.toLocaleLowerCase().includes(needle))
    : normalized;
  return { models: filtered.slice(0, RESULT_LIMIT), total: filtered.length };
}
```

- [ ] **Step 5: Document the environment override**

Append to `backend/.env.example`:

```env
# OpenRouter models shown in the "Mô hình đề xuất" group, in display order.
# Set to an empty value to disable recommendations. Restart the backend after changes.
OPENROUTER_RECOMMENDED_MODELS="openrouter/free"
```

- [ ] **Step 6: Run focused tests and backend build**

Run:

```powershell
npm test -- src/services/openrouter_models.test.ts --runInBand
npm run build
```

Expected: the new suite passes and TypeScript exits with code 0.

- [ ] **Step 7: Commit the backend service without staging unrelated files**

Run from `C:/Users/PC/Documents/LLM` after reviewing `git diff -- backend/...`:

```powershell
git add -- backend/src/config/openrouter_models.ts backend/src/services/openrouter_models.ts backend/src/services/openrouter_models.test.ts backend/.env.example
git commit -m "feat: add cached OpenRouter model catalog"
```

Expected: only the four named backend files are included.

---

### Task 2: Authenticated backend catalog endpoint

**Files:**
- Modify: `../backend/src/routes/llm-settings.ts`
- Modify: `../backend/src/routes/llm-settings.contract.test.ts`

**Interfaces:**
- Consumes: `listOpenRouterModels(query?: string)` from Task 1.
- Produces: `GET /api/settings/llm/openrouter/models?q=<search>` returning `{ success: true, models, total }`.

- [ ] **Step 1: Add failing route contract tests**

Mock `listOpenRouterModels`, then add assertions for authentication, search forwarding, and upstream failure:

```ts
jest.mock('../services/openrouter_models', () => ({ listOpenRouterModels: jest.fn() }));
import { listOpenRouterModels } from '../services/openrouter_models';
const listModels = listOpenRouterModels as jest.Mock;

it('returns the authenticated OpenRouter model catalog', async () => {
  listModels.mockResolvedValue({ models: [{ id: 'openrouter/free', free: true, recommended: true }], total: 1 });
  const response = await request(app)
    .get('/api/settings/llm/openrouter/models?q=free')
    .set(auth());
  expect(response.status).toBe(200);
  expect(listModels).toHaveBeenCalledWith('free');
  expect(response.body).toEqual({ success: true, models: [{ id: 'openrouter/free', free: true, recommended: true }], total: 1 });
});

it('protects the model catalog and validates query length', async () => {
  expect((await request(app).get('/api/settings/llm/openrouter/models')).status).toBe(401);
  const response = await request(app)
    .get(`/api/settings/llm/openrouter/models?q=${'x'.repeat(121)}`)
    .set(auth());
  expect(response.status).toBe(400);
});

it('returns a controlled catalog failure', async () => {
  listModels.mockRejectedValue(new Error('upstream detail'));
  const response = await request(app).get('/api/settings/llm/openrouter/models').set(auth());
  expect(response.status).toBe(502);
  expect(response.body).toEqual({ error: 'Unable to load OpenRouter models' });
});
```

- [ ] **Step 2: Run the route suite and verify RED**

Run:

```powershell
npm test -- src/routes/llm-settings.contract.test.ts --runInBand
```

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Add the authenticated route**

Import `listOpenRouterModels` and add this route before the existing settings `GET /` handler:

```ts
const ModelCatalogQuerySchema = z.object({ q: z.string().trim().max(120).optional() });

router.get('/openrouter/models', userAuthMiddleware, requireAuth, async (req, res) => {
  const parsed = ModelCatalogQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid model search query' });
  try {
    const result = await listOpenRouterModels(parsed.data.q || '');
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Get OpenRouter models error:', error instanceof Error ? error.message : error);
    return res.status(502).json({ error: 'Unable to load OpenRouter models' });
  }
});
```

- [ ] **Step 4: Run the route suite and backend build**

Run:

```powershell
npm test -- src/routes/llm-settings.contract.test.ts --runInBand
npm run build
```

Expected: route suite passes and TypeScript exits with code 0.

- [ ] **Step 5: Commit only the reviewed route changes**

Because both route files were already modified before this feature, inspect their diffs and confirm the staged patch contains intended existing fixes plus this endpoint before committing:

```powershell
git diff -- backend/src/routes/llm-settings.ts backend/src/routes/llm-settings.contract.test.ts
git add -- backend/src/routes/llm-settings.ts backend/src/routes/llm-settings.contract.test.ts
git diff --cached -- backend/src/routes/llm-settings.ts backend/src/routes/llm-settings.contract.test.ts
git commit -m "feat: expose OpenRouter model catalog"
```

---

### Task 3: Searchable grouped OpenRouter picker

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `lib/settings-api.ts`
- Create: `components/settings/OpenRouterModelPicker.tsx`
- Create: `test/openrouter-model-picker.test.tsx`

**Interfaces:**
- Produces: `OpenRouterModel`
- Produces: `getOpenRouterModels(query?: string, signal?: AbortSignal)`
- Produces: `OpenRouterModelPicker({ value, onValueChange, disabled })`

- [ ] **Step 1: Install the Radix popover primitive**

Run:

```powershell
npm install @radix-ui/react-popover
```

Expected: `package.json` and `package-lock.json` contain the direct dependency; no other dependency is added.

- [ ] **Step 2: Write failing picker tests**

Mock `getOpenRouterModels` and cover grouped ordering, search, keyboard selection, retry, and manual entry. The core expectations are:

```tsx
const models = [
  { id: 'openrouter/free', name: 'Free Models Router', provider: 'openrouter', contextLength: 200000, promptPricePerMillion: 0, completionPricePerMillion: 0, free: true, recommended: true },
  { id: 'free/model:free', name: 'Free Model', provider: 'free', contextLength: 64000, promptPricePerMillion: 0, completionPricePerMillion: 0, free: true, recommended: false },
  { id: 'paid/model', name: 'Paid Model', provider: 'paid', contextLength: 32000, promptPricePerMillion: 1, completionPricePerMillion: 2, free: false, recommended: false },
];

it('groups recommendations, free models, and paid models without duplicates', async () => {
  getModels.mockResolvedValue({ success: true, models, total: 3 });
  render(<OpenRouterModelPicker value="" onValueChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Mô hình' }));
  expect(await screen.findByText('Mô hình đề xuất')).toBeInTheDocument();
  expect(screen.getByText('Mô hình miễn phí')).toBeInTheDocument();
  expect(screen.getByText('Tất cả mô hình')).toBeInTheDocument();
  expect(screen.getAllByText('Free Models Router')).toHaveLength(1);
  expect(screen.getByText('Miễn phí')).toBeInTheDocument();
});

it('debounces search and selects with the keyboard', async () => {
  vi.useFakeTimers();
  getModels.mockResolvedValue({ success: true, models: [models[2]], total: 1 });
  const onValueChange = vi.fn();
  render(<OpenRouterModelPicker value="" onValueChange={onValueChange} />);
  const input = screen.getByRole('combobox', { name: 'Mô hình' });
  await userEvent.type(input, 'paid');
  await vi.advanceTimersByTimeAsync(250);
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onValueChange).toHaveBeenCalledWith('paid/model');
  vi.useRealTimers();
});

it('falls back to manual model entry when the catalog fails', async () => {
  getModels.mockRejectedValue(new Error('network'));
  render(<OpenRouterModelPicker value="alias/model" onValueChange={vi.fn()} />);
  await userEvent.click(screen.getByRole('combobox', { name: 'Mô hình' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải danh mục mô hình');
  await userEvent.click(screen.getByRole('button', { name: 'Nhập ID mô hình thủ công' }));
  expect(screen.getByRole('textbox', { name: 'ID mô hình thủ công' })).toHaveValue('alias/model');
});
```

- [ ] **Step 3: Run the picker test and verify RED**

Run:

```powershell
npm test -- --run test/openrouter-model-picker.test.tsx
```

Expected: FAIL because the picker and catalog client do not exist.

- [ ] **Step 4: Add catalog types and API client**

Add to `lib/settings-api.ts`:

```ts
export interface OpenRouterModel {
  id: string;
  name: string;
  provider: string;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  free: boolean;
  recommended: boolean;
}

export async function getOpenRouterModels(query = '', signal?: AbortSignal): Promise<{
  success: boolean;
  models: OpenRouterModel[];
  total: number;
}> {
  const params = new URLSearchParams();
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.size ? `?${params.toString()}` : '';
  return apiFetch(`/api/proxy/settings/llm/openrouter/models${suffix}`, undefined, signal);
}
```

- [ ] **Step 5: Implement the picker component**

The component must use `@radix-ui/react-popover` with a portal to avoid clipping inside the scrollable settings dialog. Implement these exact behaviors:

```ts
export interface OpenRouterModelPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

// State: open, query, manualMode, models, total, loading, error, activeIndex, retryVersion.
// On open/query/retryVersion: wait 250 ms, abort the previous request, call
// getOpenRouterModels(query, signal), then update results without clearing value.
// Closed combobox text is `value`; open combobox text is `query`.
// ArrowDown/ArrowUp move activeIndex; Enter selects that exact model ID; Escape closes.
// Popover.Portal content uses `z-dropdown`, `surface-vibrant`, `shadow-menu`,
// and `w-[var(--radix-popover-trigger-width)]`.
// Group rows by recommended, remaining free, and remaining paid, so each model
// is rendered once. Result rows use role="option" and min-h-11.
// The footer action "Nhập ID mô hình thủ công" enables manualMode.
// Manual mode renders Input label="ID mô hình thủ công" and a ghost button
// "Chọn từ danh mục" that returns without changing `value`.
// Loading renders three skeleton rows; failure renders role="alert", "Thử lại",
// and the manual-entry action; zero results retains the manual-entry action.
```

Use existing `Input`, `Button`, `Badge`, `cn`, and Lucide `ChevronDown`, `Search`, and `Star` components. Format context as `32K`, `200K`, or `1M`; format paid prices as `$1/M vào · $2/M ra`. Do not add CSS hex values or new theme structure.

- [ ] **Step 6: Run picker tests, lint, and build**

Run:

```powershell
npm test -- --run test/openrouter-model-picker.test.tsx
npm run lint
npm run build
```

Expected: focused tests pass, ESLint reports zero warnings, and Next.js production build succeeds.

- [ ] **Step 7: Commit the isolated picker unit**

```powershell
git add -- package.json package-lock.json lib/settings-api.ts components/settings/OpenRouterModelPicker.tsx test/openrouter-model-picker.test.tsx
git diff --cached
git commit -m "feat: add searchable OpenRouter model picker"
```

Expected: unrelated `.dockerignore`, `Dockerfile`, route fixes, and design-system changes remain unstaged.

---

### Task 4: Integrate picker into LLM settings and verify end to end

**Files:**
- Modify: `components/settings/LLMProviderForm.tsx`
- Modify: `test/settings-dialogs.test.tsx`

**Interfaces:**
- Consumes: `OpenRouterModelPicker` from Task 3.
- Preserves: `LLMConfigInput.model` and existing save/test methods.

- [ ] **Step 1: Extend the existing dialog tests before integration**

Add `getOpenRouterModels` to the settings API mock and test selection submission:

```tsx
const getModels = vi.fn(async () => ({
  success: true,
  total: 1,
  models: [{
    id: 'openrouter/free', name: 'Free Models Router', provider: 'openrouter',
    contextLength: 200000, promptPricePerMillion: 0, completionPricePerMillion: 0,
    free: true, recommended: true,
  }],
}));

// Include in vi.mock('@/lib/settings-api'):
getOpenRouterModels: (...args: unknown[]) => getModels(...args),

it('selects a recommended OpenRouter model and submits its exact ID', async () => {
  const user = userEvent.setup();
  render(<LLMSettingsDialog />);
  await user.click(screen.getByLabelText('Mở cài đặt nhà cung cấp LLM'));
  await user.click(await screen.findByRole('combobox', { name: 'Mô hình' }));
  await user.click(await screen.findByRole('option', { name: /Free Models Router/ }));
  await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));
  await waitFor(() => expect(saveLLM).toHaveBeenCalledWith(expect.objectContaining({ model: 'openrouter/free' })));
});
```

Update the dirty-form test to query the OpenRouter combobox or enter manual mode instead of assuming the model control is always a textbox.

- [ ] **Step 2: Run dialog tests and verify RED**

Run:

```powershell
npm test -- --run test/settings-dialogs.test.tsx
```

Expected: FAIL because `LLMProviderForm` still renders the generic input.

- [ ] **Step 3: Integrate the provider-specific control**

Import the picker and replace the current unconditional model `Input` with:

```tsx
{provider === 'openrouter' ? (
  <OpenRouterModelPicker
    value={model}
    onValueChange={(value) => { setModel(value); onDirtyChange?.(true); }}
    disabled={Boolean(busy) || loadError}
  />
) : (
  <Input
    label="Mô hình"
    value={model}
    onChange={(event) => { setModel(event.target.value); onDirtyChange?.(true); }}
    placeholder="Ví dụ: openai/gpt-4.1-mini"
    disabled={Boolean(busy) || loadError}
    required
  />
)}
```

Do not reset `model` when switching providers; preserving the current value avoids accidental data loss and matches current behavior.

- [ ] **Step 4: Run frontend regression verification**

Run:

```powershell
npm test -- --run
npm run lint
npm run build
```

Expected: all frontend suites pass, lint has zero warnings, and the production build succeeds.

- [ ] **Step 5: Run backend regression verification**

Run from `../backend`:

```powershell
npm test -- --runInBand
npm run build
```

Expected: all backend suites pass and TypeScript exits with code 0.

- [ ] **Step 6: Perform live catalog and browser verification**

With backend port `3001` and frontend port `3000` available exactly once, verify:

```powershell
Invoke-RestMethod -Uri "https://openrouter.ai/api/v1/models?output_modalities=text&sort=pricing-low-to-high" -TimeoutSec 20 | Select-Object -ExpandProperty data | Select-Object -First 3 id,name
```

Then authenticate in the local app, open **Nhà cung cấp LLM**, select **OpenRouter**, and verify:

- `Mô hình đề xuất` appears first.
- `openrouter/free` is selectable and marked `Đề xuất` plus `Miễn phí`.
- A specific `:free` search returns matching free models before paid models.
- Keyboard Arrow/Enter selection works.
- Manual entry works after a simulated catalog failure or via the footer action.
- Saving and **Kiểm tra kết nối** submit the selected exact model ID.
- The picker remains above the modal in both light and dark themes.

- [ ] **Step 7: Commit the integration after reviewing existing dirty files**

`test/settings-dialogs.test.tsx` already contains an earlier provider-dropdown fix. Review and intentionally include that fix with this integration:

```powershell
git diff -- components/settings/LLMProviderForm.tsx test/settings-dialogs.test.tsx
git add -- components/settings/LLMProviderForm.tsx test/settings-dialogs.test.tsx
git diff --cached
git commit -m "feat: integrate OpenRouter recommendations"
```

- [ ] **Step 8: Report exact verification evidence and remaining unrelated changes**

Record the passing suite counts, lint/build exit status, live endpoint result count, browser scenarios checked, commit hashes, and `git status --short` for both repositories. Do not claim unrelated dirty files as part of this feature.

---

## Self-review

- Spec coverage: live catalog, recommendation configuration, free priority, search, manual entry, missing/stale/error states, accessibility, security, theming, tests, and live verification each map to a task.
- Placeholder scan: no deferred implementation markers remain; component behavior and API signatures are explicit.
- Type consistency: backend and frontend both use `id`, `name`, `provider`, `contextLength`, `promptPricePerMillion`, `completionPricePerMillion`, `free`, and `recommended`.
- Scope: backend catalog delivery and frontend selection form one end-to-end feature and are not independently useful enough to split into separate plans.
