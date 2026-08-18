# Gemini LLM Provider Design

**Date:** 2026-08-09

**Status:** Approved

## Goal

Add Google Gemini as a first-class DocAI LLM provider without creating a second request pipeline. Gemini must appear in the settings UI, use a server-managed official endpoint, require an encrypted per-user API key, and work through the existing non-streaming, streaming, structured-output, vision, and connection-test paths.

## Chosen Integration

DocAI will use Google's OpenAI-compatible Gemini API rather than the native `generateContent` protocol.

- Provider identifier: `gemini`
- Display label: `Google Gemini`
- Canonical base URL: `https://generativelanguage.googleapis.com/v1beta/openai`
- Chat completions endpoint: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
- Authentication: `Authorization: Bearer <API_KEY>`
- Example model copy: `gemini-3.6-flash`

Google documents that Gemini's OpenAI-compatible REST API accepts the existing chat-completions request shape, bearer authentication, streaming, image input, and structured output. This matches DocAI's current provider-neutral client and minimizes provider-specific logic. The user's API-key guide remains authoritative for key creation and security; its `x-goog-api-key` example applies to the native Gemini API, while the compatibility endpoint uses bearer authentication.

Primary references:

- https://ai.google.dev/gemini-api/docs/api-key
- https://ai.google.dev/gemini-api/docs/openai

## Scope

### Included

- Extend the shared frontend and backend provider types with `gemini`.
- Accept `gemini` in the LLM settings route validation schema and system-default provider validation.
- Canonicalize Gemini URLs to the official OpenAI-compatible base URL regardless of submitted URL text.
- Build the Gemini chat-completions URL exactly once, without appending an extra `/v1` segment.
- Require an API key for Gemini in save, test, and system-default paths.
- Send the Gemini API key only from the backend using bearer authentication.
- Reuse the existing encrypted-key storage and same-provider key-reuse rules.
- Add Google Gemini to both existing settings form implementations so their provider contracts remain consistent.
- Treat Gemini as a cloud provider: make its base URL read-only and display the existing server-managed URL explanation.
- Show a Gemini-specific model placeholder while retaining a free-text model field.
- Cover backend URL, authentication, routing, persistence, and frontend interaction contracts with automated tests.
- Confirm the provider in the authenticated settings dialog with Chrome after automated verification.

### Excluded

- Native Gemini `generateContent` request and response transformations.
- Google OAuth, service-account OAuth access tokens, Vertex AI, or Google Cloud project management.
- A Gemini model-catalog endpoint or hard-coded model dropdown.
- Gemini-specific controls such as thinking levels, grounding, Files API, safety controls, or token counting.
- Database schema changes. `UserLLMConfig.provider` is already stored as a string.
- Changing the default provider for new users; OpenRouter remains the default.

## Architecture

### Provider Contract

`gemini` joins the existing `LLMProvider` union and frontend `LLMConfig` provider union. Every provider allowlist must be defined from, or kept synchronized with, this contract so Gemini is accepted consistently in HTTP validation and provider-neutral system defaults.

Gemini belongs to the cloud-provider group with OpenAI and OpenRouter. Cloud-provider URLs are canonical server-owned values and API keys are mandatory.

### URL Construction

The current generic endpoint builder recognizes `/v1` and OpenRouter's `/api/v1`, but Gemini's canonical base ends in `/v1beta/openai`. Gemini therefore needs an explicit endpoint rule:

1. Normalize trailing slashes.
2. Preserve an already complete `/chat/completions` endpoint.
3. For `gemini`, append `/chat/completions` directly to the canonical Gemini base.
4. Keep all existing provider behavior unchanged.

This must produce exactly:

`https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`

### Authentication and Secret Handling

The OpenAI-compatible Gemini endpoint uses the same bearer header shape already emitted for keyed providers. Gemini must be added to `providerRequiresApiKey`; no Gemini-specific query parameter or browser-visible header is needed.

The existing security rules remain mandatory:

- API keys are submitted to authenticated DocAI server routes over the existing proxy.
- Keys are encrypted before database storage.
- Settings responses expose only `hasApiKey`, never plaintext or encrypted key material.
- A saved key may be reused only while testing or saving the same provider.
- Switching to Gemini from another provider requires a newly submitted Gemini key.
- Keys must not be logged, embedded in URLs, committed, or exposed to client-side provider calls.

### Frontend Behavior

Both `LLMProviderForm` and the legacy `LLMSettingsForm` must understand Gemini so the UI cannot drift depending on which form is mounted.

In the active settings dialog:

- The provider list contains `Google Gemini` after `OpenAI` and before local providers.
- Selecting it changes the URL to the canonical Gemini base.
- The URL field becomes read-only.
- The helper text says the official URL is managed by DocAI.
- The model field remains editable and uses `Ví dụ: gemini-3.6-flash` as its placeholder.
- The API-key field is required when no Gemini key is already stored.
- Test and save use the existing loading, success, failure, dirty-state, and discard-confirmation behavior.

No Gemini model is silently selected. Model availability changes independently of DocAI, so users supply the exact model ID authorized for their account.

### Backend Behavior

The settings API accepts and persists `provider: "gemini"`. Canonicalization prevents clients from redirecting the named Gemini provider to an arbitrary host. Existing DNS pinning, redirect blocking, proxy bypass, timeout handling, and public-address validation remain in force.

All existing LLM operations continue through the provider-neutral functions:

- `callLLM`
- `streamLLM`
- `callLLMVision`
- `testLLMConnection`

They receive the Gemini endpoint and bearer header from shared provider helpers; no duplicate Gemini transport is introduced.

## Error Handling

- Missing Gemini API key: return the existing controlled 400 response, `API key is required for this provider`.
- Invalid or unreachable official endpoint: retain the current safe provider-URL and connection-test errors.
- Gemini authentication, quota, model, or payload error: retain the upstream HTTP status and safe upstream message through `formatLLMError`.
- Invalid saved configuration: preserve the existing controlled configuration error without exposing key material.
- Frontend load, test, and save failures remain visible in Vietnamese and retain the user's entered model and key until they choose another provider or close the dialog.

## Testing Strategy

Development follows red-green TDD.

### Backend regression tests

- `LLMProvider` helpers canonicalize Gemini to the official compatibility base.
- Endpoint construction yields one `/chat/completions` suffix and no injected `/v1`.
- Gemini requires an API key.
- Gemini requests carry `Authorization: Bearer <key>` and no OpenRouter attribution header.
- System defaults accept `DEFAULT_LLM_PROVIDER=gemini` and require `DEFAULT_LLM_API_KEY`.
- Settings save and test schemas accept Gemini.
- Saving or testing a new Gemini configuration without a key returns 400.
- A saved Gemini key is reusable only when the provider remains Gemini.
- Switching from another provider to Gemini cannot reuse that provider's key.

### Frontend regression tests

- The shared config type and both settings forms accept `gemini`.
- The provider menu exposes `Google Gemini`.
- Selecting Gemini applies the canonical URL, read-only cloud behavior, and Gemini-specific model placeholder.
- Saving submits `provider: "gemini"` with the canonical base URL and entered model.
- A new Gemini configuration requires an API key while an existing saved Gemini key can remain blank.

### Verification

- Run focused backend and frontend tests during each red-green cycle.
- Run the complete backend and frontend test suites.
- Run backend and frontend lint/type checks and production builds.
- Run `git diff --check` without modifying unrelated dirty files.
- In authenticated Chrome QA, open the provider menu, select Google Gemini, and confirm the URL, model placeholder, key requirement, menu layering, keyboard selection, desktop layout, and 390 px mobile layout.
- Do not make a live Gemini request unless the user supplies a test API key outside source control.

## Success Criteria

The feature is complete when:

1. Google Gemini is visibly selectable as a first-class provider.
2. The frontend submits the canonical Gemini compatibility URL and a user-entered Gemini model ID.
3. The backend accepts, validates, encrypts, persists, reloads, and tests Gemini configurations under the same security rules as other cloud providers.
4. Normal, streaming, structured-output, and vision requests resolve to the exact Gemini compatibility chat-completions endpoint with bearer authentication.
5. Existing providers remain behaviorally unchanged.
6. All focused and full verification gates pass.
