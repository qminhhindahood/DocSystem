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
