/**
 * Vision provider registry (BYOK). The standalone conversion product supports
 * exactly one provider: Google Gemini for the scanned-page vision path.
 *
 * The master stack's local providers (lmstudio, ollama) and generic ones
 * (openai, custom) were deleted with the generation surface and stay deleted.
 */

export const LLM_PROVIDER_IDS = ['gemini'] as const;

export type LLMProvider = (typeof LLM_PROVIDER_IDS)[number];

export const CLOUD_PROVIDER_BASES: Record<LLMProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export function isLLMProvider(value: string): value is LLMProvider {
  return (LLM_PROVIDER_IDS as readonly string[]).includes(value);
}
