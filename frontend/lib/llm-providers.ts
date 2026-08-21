// The sole BYOK provider the backend accepts for scanned-page vision.
export const LLM_PROVIDER_OPTIONS = [
  { value: 'gemini', label: 'Google Gemini' },
] as const;

export type LLMProvider = (typeof LLM_PROVIDER_OPTIONS)[number]['value'];

export const LLM_PROVIDER_PRESETS: Record<LLMProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export function llmModelPlaceholder(_provider: LLMProvider): string {
  return 'Ví dụ: gemini-2.5-flash';
}
