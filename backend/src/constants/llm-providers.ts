/**
 * Vision provider registry (BYOK). The standalone conversion product supports
 * exactly two providers:
 *   - gemini     — Google Gemini, the wired scanned-page vision path.
 *   - openrouter — OpenRouter gateway, stored for the future Q&A feature.
 *
 * The master stack's local providers (lmstudio, ollama) and generic ones
 * (openai, custom) were deleted with the generation surface and stay deleted.
 */

export const LLM_PROVIDER_IDS = ['openrouter', 'gemini'] as const;

export type LLMProvider = (typeof LLM_PROVIDER_IDS)[number];

export const CLOUD_PROVIDER_BASES: Record<LLMProvider, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export function isLLMProvider(value: string): value is LLMProvider {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Both supported providers are cloud providers and require an API key. */
export function providerRequiresApiKey(provider: LLMProvider): boolean {
  return Object.hasOwn(CLOUD_PROVIDER_BASES, provider);
}
