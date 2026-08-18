# OpenRouter Model Picker Design

**Date:** 2026-07-18
**Status:** Approved

## Problem

The LLM settings dialog accepts an OpenRouter model only as a free-form text value. Users cannot discover the current OpenRouter catalog, distinguish free models from paid models, or see which models the application developer recommends. The catalog changes frequently and may contain hundreds or thousands of entries, so a static select is not suitable.

## Goals

- Provide a live, searchable OpenRouter model catalog.
- Put developer-recommended models first.
- Prioritize and clearly mark free models.
- Preserve manual model-ID entry for aliases and catalog edge cases.
- Keep API keys out of catalog-loading requests.
- Preserve the existing settings dialog, save/test behavior, light/dark themes, and visual design language.

## Non-goals

- Model discovery for OpenAI, LM Studio, Ollama, or custom providers.
- Automatically ranking models by subjective quality.
- Building an administrative UI for managing recommendations.
- Persisting the catalog or recommendation list in the database.

## User Experience

When `OpenRouter` is selected, the existing model text input becomes an accessible searchable combobox. Opening it shows three logical groups:

1. **Mô hình đề xuất** — configured recommendations in developer-defined order.
2. **Mô hình miễn phí** — remaining free models.
3. **Tất cả mô hình** — remaining paid models.

Each model appears only once. Recommended free models show both recommendation and free status. Each row presents the human-readable name, exact model ID, context size, and either a `Miễn phí` badge or concise input/output pricing. `openrouter/free` is pinned as the first free recommendation when configured.

Typing searches model names, IDs, and provider names. Matching recommendations remain first, followed by matching free models and then paid models. The number of rendered results is capped so the picker remains responsive with a large catalog.

The picker includes an explicit **Nhập ID mô hình thủ công** action. Manual entry supports aliases, newly released models, and IDs not returned by the catalog. An already-saved model remains visible and selectable even if it is no longer in the current response.

For other providers, the existing text input remains unchanged.

## Recommendation Configuration

The backend owns the recommendation list. A checked-in configuration file supplies defaults, and an environment variable overrides the defaults:

```env
OPENROUTER_RECOMMENDED_MODELS=openrouter/free,google/example:free,openai/example
```

The comma-separated order is the display order. Values are trimmed and deduplicated. Invalid or unavailable configured IDs are excluded from the recommendation group and logged server-side, preventing a broken suggestion from being presented. Updating the environment variable requires a backend restart.

The variable will be documented in the backend environment example. No recommendation-management UI is included.

## Architecture and Data Flow

### Backend

Add an authenticated read-only endpoint under the existing LLM settings route for the OpenRouter catalog. It will:

1. Fetch `https://openrouter.ai/api/v1/models` without forwarding or decrypting the user's API key.
2. Request text-output models.
3. Validate and normalize the upstream response into a small application-owned shape.
4. Mark models as free when their ID uses the `:free` variant or both prompt and completion prices are zero.
5. Mark models whose IDs appear in the configured recommendation list.
6. Sort recommendations first in configured order, then free models, then paid models.
7. Cache the normalized catalog in memory for approximately ten minutes.
8. Apply search and a result cap after normalization.

The response shape will contain only fields needed by the UI: `id`, `name`, `description` where useful, `contextLength`, normalized prompt/completion prices, `free`, and `recommended`.

The endpoint will use a bounded timeout and return a controlled error if OpenRouter is unavailable or returns invalid data. It will not expose upstream internals or secrets.

### Frontend

Add a catalog method to the existing settings API client and a focused OpenRouter model-picker component. `LLMProviderForm` will render the picker only for OpenRouter and continue using `Input` elsewhere.

The picker will load on demand when OpenRouter is active, debounce search input, cancel stale requests, and keep the selected ID in the parent form's existing `model` state. It will use the established surface, border, focus, radius, spacing, and z-index tokens so light and dark themes remain structurally identical.

## States and Error Handling

- **Loading:** compact skeleton rows inside the picker; the rest of the form stays usable.
- **Empty search:** explain that no matching models were found and offer manual entry.
- **Catalog failure:** show a concise Vietnamese error with retry and manual-entry actions.
- **Stale response:** ignore aborted or superseded searches.
- **Missing saved model:** retain it as the current manual value rather than clearing it.
- **Invalid recommendation:** omit it from suggestions and log a server warning.
- **Save/test:** unchanged; the selected or manually entered ID is submitted through the existing API.

## Accessibility

- Use proper combobox/listbox semantics with an associated Vietnamese label.
- Support typing, Arrow Up/Down, Enter, Escape, Tab, and visible keyboard focus.
- Announce loading, result count, empty, and error states without moving focus unexpectedly.
- Do not communicate free or recommended status by color alone.
- Maintain at least 44-pixel touch targets and the existing dialog focus trap.

## Testing and Verification

Implementation will be test-driven and cover:

- Backend normalization, free detection, recommendation ordering, deduplication, caching, timeout/error handling, search, authentication, and response caps.
- Frontend loading, grouping, search, keyboard selection, manual entry, retry, missing saved models, provider switching, dirty-state tracking, and save/test submission.
- Light/dark token usage and dialog layering regressions.
- Live read-only validation against OpenRouter's current model endpoint.
- Full backend and frontend test suites, lint, and production builds.

## Security and Privacy

Catalog loading never receives, decrypts, forwards, or logs the user's OpenRouter API key. Recommendation configuration contains model IDs only. Upstream responses are validated and reduced before being returned to the browser.
