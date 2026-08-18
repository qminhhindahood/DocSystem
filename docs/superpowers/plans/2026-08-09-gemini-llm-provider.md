# Gemini LLM Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Gemini as a first-class, encrypted per-user LLM provider through Google's OpenAI-compatible API.

**Architecture:** Define one provider contract per runtime, then make the settings API, universal LLM client, environment validation, and both frontend settings forms consume those contracts. Gemini uses the locked base `https://generativelanguage.googleapis.com/v1beta/openai`, the existing OpenAI chat-completions payloads, and backend-only bearer authentication; no parallel Gemini transport or database migration is introduced.

**Tech Stack:** TypeScript 7, Express 4, Zod 3, Prisma 5, Axios 1, Jest 29, Next.js 16, React 19, Radix UI, Vitest 4, Testing Library.

## Global Constraints

- Implement the approved contract in `docs/superpowers/specs/2026-08-09-gemini-llm-provider-design.md`.
- Provider identifier is exactly `gemini`; user-facing label is exactly `Google Gemini`.
- Canonical base URL is exactly `https://generativelanguage.googleapis.com/v1beta/openai`.
- Chat endpoint is exactly `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
- The OpenAI-compatible Gemini endpoint authenticates with `Authorization: Bearer <API_KEY>`.
- Gemini is a keyed cloud provider; its base URL is read-only in the frontend.
- Do not expose, log, hard-code, or place Gemini API keys in URLs or source control.
- Do not add a native `generateContent` transport, OAuth, Vertex AI, model catalog, or database migration.
- OpenRouter remains the new-user default.
- Preserve all existing provider behavior and unrelated dirty worktree changes.
- The implementation target files are already dirty; do not stage or commit implementation files in this session unless the user separately authorizes capturing the pre-existing changes.
- Only use subagents if the user explicitly requests them.
- Use red-green TDD for every behavior change.

---

## File Structure

### Create

- `backend/src/constants/llm-providers.ts` — backend provider IDs, type guard, canonical cloud bases, and keyed-provider predicate.
- `frontend/lib/llm-providers.ts` — frontend provider IDs, labels, presets, cloud predicate, and model placeholders.
- `frontend/test/llm-providers.test.ts` — pure frontend provider metadata contract.

### Modify

- `backend/src/services/llm_config_service.ts` — consume the backend provider contract and build the Gemini compatibility endpoint.
- `backend/src/services/llm_config_service_urls.test.ts` — prove Gemini URL, headers, requests, and system-default behavior.
- `backend/src/routes/llm-settings.ts` — accept the shared provider tuple in the save/test schema.
- `backend/src/routes/llm-settings.contract.test.ts` — prove Gemini save/test/key-reuse behavior.
- `backend/src/utils/validateEnv.ts` — accept Gemini system defaults and require their key.
- `backend/src/utils/validateEnv.test.ts` — prove valid and invalid Gemini defaults.
- `backend/prisma/schema.prisma` — update the provider documentation comment only.
- `backend/.env.example` and `README.md` — document a Gemini maintenance-default example without a real key.
- `frontend/lib/settings-api.ts` — use the shared frontend provider type.
- `frontend/components/settings/LLMProviderForm.tsx` — expose Gemini in the active settings dialog.
- `frontend/components/settings/LLMSettingsForm.tsx` — keep the secondary form aligned with the same metadata and key rules.
- `frontend/test/settings-dialogs.test.tsx` — prove active-dialog selection and submitted payload.
- `frontend/test/settings-page.test.tsx` — prove secondary-form Gemini behavior.

---

### Task 1: Establish the Backend Gemini Provider Contract

**Files:**

- Create: `backend/src/constants/llm-providers.ts`
- Modify: `backend/src/services/llm_config_service.ts`
- Modify: `backend/src/services/llm_config_service_urls.test.ts`
- Modify: `backend/src/utils/validateEnv.ts`
- Modify: `backend/src/utils/validateEnv.test.ts`

**Interfaces:**

- Produces: `LLM_PROVIDER_IDS`, `LLMProvider`, `CLOUD_PROVIDER_BASES`, `isLLMProvider(value)`, and `providerRequiresApiKey(provider)`.
- Produces: `canonicalizeProviderBaseUrl('gemini', value)` returning the official base.
- Produces: `buildChatCompletionsEndpoint(base, 'gemini')` returning the exact compatibility endpoint.
- Consumes: existing provider-neutral request bodies and `Authorization: Bearer` header handling.

- [ ] **Step 1: Add failing service tests for Gemini canonicalization, endpoint construction, key requirement, and headers**

Add these assertions to `backend/src/services/llm_config_service_urls.test.ts`:

```ts
it('canonicalizes Gemini to the official OpenAI-compatible base', () => {
  expect(canonicalizeProviderBaseUrl('gemini', 'https://attacker.example/v1'))
    .toBe('https://generativelanguage.googleapis.com/v1beta/openai');
});

it('builds the Gemini compatibility endpoint exactly once', () => {
  expect(buildChatCompletionsEndpoint(
    'https://generativelanguage.googleapis.com/v1beta/openai/',
    'gemini',
  )).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  expect(buildChatCompletionsEndpoint(
    'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    'gemini',
  )).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
});

it('requires a Gemini key and sends it only as bearer authentication', () => {
  expect(providerRequiresApiKey('gemini')).toBe(true);
  expect(providerHeaders({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    apiKey: 'gemini-secret',
  })).toEqual({
    'Content-Type': 'application/json',
    Authorization: 'Bearer gemini-secret',
  });
});

it('accepts a keyed Gemini maintenance default', () => {
  process.env.DEFAULT_LLM_PROVIDER = 'gemini';
  process.env.DEFAULT_LLM_BASE_URL = 'https://wrong.example';
  process.env.DEFAULT_LLM_MODEL = 'gemini-3.6-flash';
  process.env.DEFAULT_LLM_API_KEY = 'system-gemini-key';

  expect(resolveLLMConfig(null)).toEqual({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    apiKey: 'system-gemini-key',
  });
});
```

- [ ] **Step 2: Run the focused service test and verify RED**

Run:

```powershell
Set-Location C:\Users\PC\Documents\LLM\backend
npm test -- --runInBand src/services/llm_config_service_urls.test.ts
```

Expected: FAIL because `gemini` is not assignable to `LLMProvider`, is not canonicalized, and is not recognized as keyed.

- [ ] **Step 3: Add failing environment-validation tests**

Extend the system-default test in `backend/src/utils/validateEnv.test.ts` with:

```ts
process.env.DEFAULT_LLM_PROVIDER = 'gemini';
process.env.DEFAULT_LLM_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai';
process.env.DEFAULT_LLM_MODEL = 'gemini-3.6-flash';
delete process.env.DEFAULT_LLM_API_KEY;
expect(() => validateEnv()).toThrow(/DEFAULT_LLM_API_KEY/);

process.env.DEFAULT_LLM_API_KEY = 'gemini-key';
expect(() => validateEnv()).not.toThrow();
```

- [ ] **Step 4: Run the environment test and verify RED**

Run:

```powershell
npm test -- --runInBand src/utils/validateEnv.test.ts
```

Expected: FAIL because `validateEnv` rejects `gemini` as an unsupported provider.

- [ ] **Step 5: Create the shared backend provider contract**

Create `backend/src/constants/llm-providers.ts`:

```ts
export const LLM_PROVIDER_IDS = [
  'openai',
  'openrouter',
  'gemini',
  'lmstudio',
  'ollama',
  'custom',
] as const;

export type LLMProvider = (typeof LLM_PROVIDER_IDS)[number];

export const CLOUD_PROVIDER_BASES: Partial<Record<LLMProvider, string>> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export function isLLMProvider(value: string): value is LLMProvider {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

export function providerRequiresApiKey(provider: LLMProvider): boolean {
  return Object.hasOwn(CLOUD_PROVIDER_BASES, provider);
}
```

- [ ] **Step 6: Consume the contract and add the Gemini endpoint rule**

In `backend/src/services/llm_config_service.ts`:

```ts
import {
  CLOUD_PROVIDER_BASES,
  LLM_PROVIDER_IDS,
  type LLMProvider,
  providerRequiresApiKey,
} from '../constants/llm-providers';

export type { LLMProvider } from '../constants/llm-providers';
export { providerRequiresApiKey } from '../constants/llm-providers';
```

Delete the local provider union, cloud-base map, and local key predicate. Update endpoint construction before the generic `/v1` branches:

```ts
if (provider === 'gemini') return `${normalized}/chat/completions`;
```

Use `LLM_PROVIDER_IDS` for system-default support:

```ts
const supported: readonly LLMProvider[] = LLM_PROVIDER_IDS;
```

Update the file header to list Gemini and describe OpenAI-compatible chat-completions endpoints without claiming every base ends in `/v1`.

- [ ] **Step 7: Update environment validation to use the shared contract**

In `backend/src/utils/validateEnv.ts`, import `isLLMProvider` and `providerRequiresApiKey`, then replace the duplicated provider list and cloud-provider list:

```ts
if (!provider || !isLLMProvider(provider)) {
  throw new Error('DEFAULT_LLM_PROVIDER must be openai, openrouter, gemini, lmstudio, ollama, or custom');
}
if (providerRequiresApiKey(provider) && !process.env.DEFAULT_LLM_API_KEY?.trim()) {
  throw new Error('DEFAULT_LLM_API_KEY is required for cloud system defaults');
}
```

- [ ] **Step 8: Run focused backend tests and verify GREEN**

Run:

```powershell
npm test -- --runInBand src/services/llm_config_service_urls.test.ts src/utils/validateEnv.test.ts
```

Expected: both suites PASS with the Gemini cases included.

- [ ] **Step 9: Record the backend provider checkpoint without staging**

```powershell
Set-Location C:\Users\PC\Documents\LLM
git status --short -- backend/src/constants/llm-providers.ts backend/src/services/llm_config_service.ts backend/src/services/llm_config_service_urls.test.ts backend/src/utils/validateEnv.ts backend/src/utils/validateEnv.test.ts
```

Expected: the five scoped paths show the intended modifications; nothing is staged or committed because four targets already contained user changes before this task.

---

### Task 2: Accept and Secure Gemini Settings

**Files:**

- Modify: `backend/src/routes/llm-settings.ts`
- Modify: `backend/src/routes/llm-settings.contract.test.ts`

**Interfaces:**

- Consumes: `LLM_PROVIDER_IDS`, `LLMProvider`, `canonicalizeProviderBaseUrl`, and `providerRequiresApiKey` from Task 1.
- Produces: authenticated save/test endpoints that accept `provider: "gemini"`, canonicalize its base, and enforce same-provider key reuse.

- [ ] **Step 1: Add a failing save-contract test**

Add to `backend/src/routes/llm-settings.contract.test.ts`:

```ts
it('accepts Gemini, canonicalizes its URL, and encrypts its submitted key', async () => {
  findUnique.mockResolvedValue(null);
  upsert.mockResolvedValue({
    id: 'cfg',
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
  });

  const response = await request(app).post('/api/settings/llm/').set(auth()).send({
    provider: 'gemini',
    baseUrl: 'https://attacker.example/v1',
    model: 'gemini-3.6-flash',
    apiKey: 'new-gemini-key',
  });

  expect(response.status).toBe(200);
  expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
    create: expect.objectContaining({
      provider: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      encryptedApiKey: 'encrypted-new',
    }),
  }));
});
```

- [ ] **Step 2: Add failing key-isolation tests**

Add:

```ts
it('requires a new key when switching to Gemini', async () => {
  findUnique.mockResolvedValue({
    provider: 'openai', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
  });

  const response = await request(app).post('/api/settings/llm/test').set(auth()).send({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    apiKey: '',
  });

  expect(response.status).toBe(400);
  expect(testConnection).not.toHaveBeenCalled();
});

it('reuses a saved Gemini key only for Gemini', async () => {
  findUnique.mockResolvedValue({
    provider: 'gemini', encryptedApiKey: 'old', apiKeyIv: 'iv', apiKeyAuthTag: 'tag',
  });

  const response = await request(app).post('/api/settings/llm/test').set(auth()).send({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    apiKey: '',
  });

  expect(response.status).toBe(200);
  expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKey: 'saved-secret',
  }));
});
```

- [ ] **Step 3: Run the route contract and verify RED**

Run:

```powershell
Set-Location C:\Users\PC\Documents\LLM\backend
npm test -- --runInBand src/routes/llm-settings.contract.test.ts
```

Expected: FAIL with HTTP 400 because the Zod provider enum does not contain `gemini`.

- [ ] **Step 4: Make route validation consume the shared tuple**

In `backend/src/routes/llm-settings.ts`:

```ts
import { LLM_PROVIDER_IDS, type LLMProvider } from '../constants/llm-providers';
```

Remove the service-only `LLMProvider` type import and change the schema field:

```ts
provider: z.enum(LLM_PROVIDER_IDS),
```

- [ ] **Step 5: Run the route contract and verify GREEN**

Run:

```powershell
npm test -- --runInBand src/routes/llm-settings.contract.test.ts
```

Expected: PASS, including canonicalization and key-isolation cases.

- [ ] **Step 6: Record the settings API checkpoint without staging**

```powershell
Set-Location C:\Users\PC\Documents\LLM
git status --short -- backend/src/routes/llm-settings.ts backend/src/routes/llm-settings.contract.test.ts
```

Expected: both scoped paths show the intended modifications and remain unstaged.

---

### Task 3: Add Shared Frontend Gemini Metadata and UI Behavior

**Files:**

- Create: `frontend/lib/llm-providers.ts`
- Create: `frontend/test/llm-providers.test.ts`
- Modify: `frontend/lib/settings-api.ts`
- Modify: `frontend/components/settings/LLMProviderForm.tsx`
- Modify: `frontend/components/settings/LLMSettingsForm.tsx`
- Modify: `frontend/test/settings-dialogs.test.tsx`
- Modify: `frontend/test/settings-page.test.tsx`

**Interfaces:**

- Produces: `LLMProvider`, `LLM_PROVIDER_OPTIONS`, `LLM_PROVIDER_PRESETS`, `isCloudLLMProvider(provider)`, and `llmModelPlaceholder(provider)`.
- Consumes: existing `Select`, `Input`, settings API calls, encrypted-key presence flag, dirty-state handling, and Vietnamese feedback states.

- [ ] **Step 1: Add a failing pure metadata test**

Create `frontend/test/llm-providers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  LLM_PROVIDER_OPTIONS,
  LLM_PROVIDER_PRESETS,
  isCloudLLMProvider,
  llmModelPlaceholder,
} from '@/lib/llm-providers';

describe('LLM provider metadata', () => {
  it('defines Gemini as a locked keyed cloud provider', () => {
    expect(LLM_PROVIDER_OPTIONS).toContainEqual({ value: 'gemini', label: 'Google Gemini' });
    expect(LLM_PROVIDER_PRESETS.gemini)
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(isCloudLLMProvider('gemini')).toBe(true);
    expect(llmModelPlaceholder('gemini')).toBe('Ví dụ: gemini-3.6-flash');
  });
});
```

- [ ] **Step 2: Add failing active-dialog behavior tests**

Add to `frontend/test/settings-dialogs.test.tsx`:

```tsx
it('configures Google Gemini with the official compatibility URL', async () => {
  const user = userEvent.setup();
  render(<LLMSettingsDialog />);
  await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));

  const provider = await screen.findByRole('combobox', { name: 'Nhà cung cấp' });
  await user.click(provider);
  await user.click(screen.getByRole('option', { name: 'Google Gemini' }));

  expect(screen.getByLabelText('URL cơ sở')).toHaveValue(
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
  expect(screen.getByLabelText('URL cơ sở')).toHaveAttribute('readonly');
  expect(screen.getByPlaceholderText('Ví dụ: gemini-3.6-flash')).toBeInTheDocument();
  expect(screen.getByLabelText('Khóa API')).toBeRequired();
});

it('submits the exact Gemini provider contract', async () => {
  const user = userEvent.setup();
  render(<LLMSettingsDialog />);
  await user.click(screen.getByRole('button', { name: 'Cài đặt LLM' }));
  await user.click(await screen.findByRole('combobox', { name: 'Nhà cung cấp' }));
  await user.click(screen.getByRole('option', { name: 'Google Gemini' }));
  await user.type(screen.getByLabelText('Mô hình'), 'gemini-3.6-flash');
  await user.type(screen.getByLabelText('Khóa API'), 'gemini-key');
  await user.click(screen.getByRole('button', { name: 'Lưu cấu hình' }));

  await waitFor(() => expect(saveLLM).toHaveBeenCalledWith({
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.6-flash',
    apiKey: 'gemini-key',
  }));
});
```

- [ ] **Step 3: Add a failing secondary-form alignment test**

Add to `frontend/test/settings-page.test.tsx`:

```tsx
it('keeps the secondary form aligned with the Gemini provider contract', async () => {
  mockGet.mockResolvedValue({ success: true, config: null });
  const { LLMSettingsForm } = await import('@/components/settings/LLMSettingsForm');
  const user = userEvent.setup();
  render(<LLMSettingsForm />);
  await screen.findByRole('heading', { name: 'Nhà cung cấp LLM' });

  await user.click(screen.getByRole('combobox', { name: 'Nhà cung cấp' }));
  await user.click(screen.getByRole('option', { name: 'Google Gemini' }));

  expect(screen.getByLabelText('URL cơ sở')).toHaveValue(
    'https://generativelanguage.googleapis.com/v1beta/openai',
  );
  expect(screen.getByLabelText('URL cơ sở')).toHaveAttribute('readonly');
  expect(screen.getByPlaceholderText('Ví dụ: gemini-3.6-flash')).toBeInTheDocument();
  expect(screen.getByLabelText('Khóa API')).toBeRequired();
});
```

- [ ] **Step 4: Run the frontend tests and verify RED**

Run:

```powershell
Set-Location C:\Users\PC\Documents\LLM\frontend
npm test -- --run test/llm-providers.test.ts test/settings-dialogs.test.tsx test/settings-page.test.tsx
```

Expected: FAIL because the metadata module and Gemini option do not exist.

- [ ] **Step 5: Create shared frontend provider metadata**

Create `frontend/lib/llm-providers.ts`:

```ts
export const LLM_PROVIDER_OPTIONS = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'lmstudio', label: 'LM Studio' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'custom', label: 'Tùy chỉnh' },
] as const;

export type LLMProvider = (typeof LLM_PROVIDER_OPTIONS)[number]['value'];

export const LLM_PROVIDER_PRESETS: Record<LLMProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  lmstudio: 'http://localhost:1234',
  ollama: 'http://localhost:11434',
  custom: '',
};

const CLOUD_PROVIDERS = new Set<LLMProvider>(['openrouter', 'openai', 'gemini']);

export function isCloudLLMProvider(provider: LLMProvider): boolean {
  return CLOUD_PROVIDERS.has(provider);
}

export function llmModelPlaceholder(provider: LLMProvider): string {
  return provider === 'gemini'
    ? 'Ví dụ: gemini-3.6-flash'
    : 'Ví dụ: openai/gpt-4.1-mini';
}
```

- [ ] **Step 6: Make settings API types consume the shared provider type**

At the top of `frontend/lib/settings-api.ts`:

```ts
import type { LLMProvider } from '@/lib/llm-providers';
```

Then change:

```ts
provider: LLMProvider;
```

- [ ] **Step 7: Update the active dialog form**

In `frontend/components/settings/LLMProviderForm.tsx`, remove the local presets and options. Import and use:

```ts
import {
  LLM_PROVIDER_OPTIONS,
  LLM_PROVIDER_PRESETS,
  isCloudLLMProvider,
  llmModelPlaceholder,
} from '@/lib/llm-providers';
```

Replace local lookups and conditions with:

```tsx
const [baseUrl, setBaseUrl] = useState(LLM_PROVIDER_PRESETS.openrouter);

setBaseUrl(LLM_PROVIDER_PRESETS[next]);

const cloud = isCloudLLMProvider(provider);

<Select
  label="Nhà cung cấp"
  value={provider}
  onValueChange={changeProvider}
  options={[...LLM_PROVIDER_OPTIONS]}
  disabled={Boolean(busy) || loadError}
/>

<Input
  label="Mô hình"
  value={model}
  onChange={(event) => {
    setModel(event.target.value);
    onDirtyChange?.(true);
  }}
  placeholder={llmModelPlaceholder(provider)}
  disabled={Boolean(busy) || loadError}
  required
/>
```

Keep `OpenRouterModelPicker` for OpenRouter only, and keep the existing `required={cloud && !hasApiKey}` rule so it now covers Gemini.

- [ ] **Step 8: Align the secondary settings form**

In `frontend/components/settings/LLMSettingsForm.tsx`, import the same metadata helpers, type `provider` as `LLMProvider`, track `hasApiKey`, and add a provider-change function:

```ts
const [provider, setProvider] = useState<LLMProvider>('openrouter');
const [hasApiKey, setHasApiKey] = useState(false);

function changeProvider(value: string) {
  const next = value as LLMProvider;
  setProvider(next);
  setBaseUrl(LLM_PROVIDER_PRESETS[next]);
  setApiKey('');
  setHasApiKey(false);
  setTestResult(null);
}
```

On load, call `setHasApiKey(Boolean(data.config.hasApiKey))`. On successful save, call `setHasApiKey(true)` when an API key was submitted or the returned config reports `hasApiKey`. Use `isCloudLLMProvider(provider)` for URL `readOnly` and API-key `required`, and use `llmModelPlaceholder(provider)` for model copy. Render `[...LLM_PROVIDER_OPTIONS]` in the select.

- [ ] **Step 9: Run the frontend tests and verify GREEN**

Run:

```powershell
npm test -- --run test/llm-providers.test.ts test/settings-dialogs.test.tsx test/settings-page.test.tsx
```

Expected: all three suites PASS and the submitted payload contains the exact Gemini contract.

- [ ] **Step 10: Record the frontend provider checkpoint without staging**

```powershell
Set-Location C:\Users\PC\Documents\LLM
git status --short -- frontend/lib/llm-providers.ts frontend/lib/settings-api.ts frontend/components/settings/LLMProviderForm.tsx frontend/components/settings/LLMSettingsForm.tsx frontend/test/llm-providers.test.ts frontend/test/settings-dialogs.test.tsx frontend/test/settings-page.test.tsx
```

Expected: the seven scoped paths show the intended modifications and remain unstaged.

---

### Task 4: Document Gemini Without Changing Persistence

**Files:**

- Modify: `backend/prisma/schema.prisma`
- Modify: `backend/.env.example`
- Modify: `README.md`

**Interfaces:**

- Consumes: exact provider ID, base URL, model example, and generic maintenance-default environment variables from Tasks 1–3.
- Produces: operator documentation that does not contain a real secret or imply a Prisma migration.

- [ ] **Step 1: Update the Prisma field comment**

Change only the comment on `UserLLMConfig.provider`:

```prisma
provider String // openai, openrouter, gemini, lmstudio, ollama, custom
```

- [ ] **Step 2: Add a commented Gemini maintenance-default example**

After the existing OpenRouter example in `backend/.env.example` and `README.md`, add:

```dotenv
# Gemini alternative:
# DEFAULT_LLM_PROVIDER="gemini"
# DEFAULT_LLM_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
# DEFAULT_LLM_MODEL="gemini-3.6-flash"
# DEFAULT_LLM_API_KEY="your-gemini-key"
```

Keep every line commented and never insert a working credential.

- [ ] **Step 3: Verify documentation hygiene**

Run:

```powershell
Set-Location C:\Users\PC\Documents\LLM
rg -n "gemini|generativelanguage" backend/prisma/schema.prisma backend/.env.example README.md
git diff --check -- backend/prisma/schema.prisma backend/.env.example README.md
```

Expected: Gemini appears only in the provider comment and commented examples; `git diff --check` reports no errors.

- [ ] **Step 4: Record the documentation checkpoint without staging**

```powershell
git status --short -- backend/prisma/schema.prisma backend/.env.example README.md
```

Expected: the three already-dirty documentation paths remain unstaged.

---

### Task 5: Full Verification and Authenticated Chrome QA

**Files:**

- Verify all files from Tasks 1–4.
- Do not modify unrelated dirty files to make a gate pass.

**Interfaces:**

- Consumes: complete Gemini provider implementation.
- Produces: automated and browser evidence that Gemini is selectable and correctly wired without regressing existing providers.

- [ ] **Step 1: Run the full backend suite**

```powershell
Set-Location C:\Users\PC\Documents\LLM\backend
npm test -- --runInBand
```

Expected: all Jest suites PASS with zero failures.

- [ ] **Step 2: Build the backend**

```powershell
npm run build
```

Expected: TypeScript compilation exits 0.

- [ ] **Step 3: Run the full frontend suite**

```powershell
Set-Location C:\Users\PC\Documents\LLM\frontend
npm test -- --run
```

Expected: all Vitest suites PASS with zero failures.

- [ ] **Step 4: Run frontend lint and production build**

```powershell
npm run lint
npm run build
```

Expected: ESLint exits 0; type generation, `tsc --noEmit`, and Next production compilation exit 0.

- [ ] **Step 5: Run repository diff hygiene**

```powershell
Set-Location C:\Users\PC\Documents\LLM
git diff --check
git status --short
```

Expected: no whitespace errors. Review status without deleting, resetting, staging, or overwriting unrelated user changes.

- [ ] **Step 6: Run the Impeccable detector once after UI work**

```powershell
Set-Location C:\Users\PC\Documents\LLM\frontend
node C:\Users\PC\.agents\skills\impeccable\scripts\detect.mjs --json .
```

Expected: `[]`. Address only findings caused by the Gemini changes, then rerun the relevant automated gates; do not run the detector repeatedly.

- [ ] **Step 7: Perform authenticated desktop Chrome QA**

Using the Chrome DevTools skill against the running local app:

1. Sign in with a designated QA account; do not weaken route protection.
2. Open `/documents`, then `Cài đặt LLM`.
3. Open `Nhà cung cấp` and verify `Google Gemini` appears between OpenAI and LM Studio.
4. Select it with pointer input.
5. Confirm `URL cơ sở` equals `https://generativelanguage.googleapis.com/v1beta/openai` and is read-only.
6. Confirm the model placeholder is `Ví dụ: gemini-3.6-flash`.
7. Confirm an unsaved new Gemini configuration marks the API-key field required.
8. Close and discard changes; do not save placeholder credentials.

- [ ] **Step 8: Perform keyboard and 390 px mobile/dark Chrome QA**

1. Reopen the dialog at a 390 × 844 viewport in dark mode.
2. Open the provider list with the keyboard, move to Google Gemini, and select with Enter.
3. Confirm the list remains above the modal, fully inside the viewport, and all provider options remain visible.
4. Confirm the URL, model, and key fields do not overflow horizontally and retain 44 px minimum control height.
5. Check console errors and warnings caused by the Gemini interaction.
6. Close and discard changes so no QA credential or provider choice persists.

- [ ] **Step 9: Review the final scoped diff**

```powershell
git diff --stat -- backend/src/services/llm_config_service.ts backend/src/routes/llm-settings.ts backend/src/utils/validateEnv.ts frontend/lib/settings-api.ts frontend/components/settings/LLMProviderForm.tsx frontend/components/settings/LLMSettingsForm.tsx
git diff -- backend/src/services/llm_config_service.ts backend/src/routes/llm-settings.ts backend/src/utils/validateEnv.ts frontend/lib/settings-api.ts frontend/components/settings/LLMProviderForm.tsx frontend/components/settings/LLMSettingsForm.tsx
git status --short -- backend/src/constants/llm-providers.ts frontend/lib/llm-providers.ts frontend/test/llm-providers.test.ts
```

Expected: every production change maps to an approved requirement and regression test; no native Gemini transport, OAuth, Vertex AI, model catalog, or migration appears.

- [ ] **Step 10: Complete the branch handoff**

Use `superpowers:verification-before-completion`, then `superpowers:finishing-a-development-branch`. Because this repository is a normal dirty checkout, do not merge, push, reset, or discard work without the user's explicit integration choice.
