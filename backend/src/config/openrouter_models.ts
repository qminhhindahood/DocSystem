export const DEFAULT_OPENROUTER_RECOMMENDED_MODELS = ['openrouter/free'] as const;

export function getRecommendedOpenRouterModelIds(
  raw: string | undefined = process.env.OPENROUTER_RECOMMENDED_MODELS,
): string[] {
  if (raw === undefined) return [...DEFAULT_OPENROUTER_RECOMMENDED_MODELS];
  return [...new Set(raw.split(',').map((id) => id.trim()).filter(Boolean))];
}
