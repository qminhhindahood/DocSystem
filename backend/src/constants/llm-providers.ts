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
