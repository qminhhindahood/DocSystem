// The two BYOK providers the backend stores (backend/src/constants/llm-providers.ts).
// Only Gemini is wired to scanned-page vision today; OpenRouter settings are
// stored for the future Q&A feature.
export const LLM_PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Google Gemini' },
  { value: 'openrouter', label: 'OpenRouter' },
] as const;

export type LLMProvider = (typeof LLM_PROVIDER_OPTIONS)[number]['value'];

export const LLM_PROVIDER_PRESETS: Record<LLMProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
};

export function llmModelPlaceholder(provider: LLMProvider): string {
  return provider === 'gemini'
    ? 'Ví dụ: gemini-2.5-flash'
    : 'Ví dụ: openai/gpt-4.1-mini';
}
