import axios from 'axios';
import { z } from 'zod';
import { getRecommendedOpenRouterModelIds } from '../config/openrouter_models';

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CACHE_TTL_MS = 10 * 60 * 1000;
const RESULT_LIMIT = 80;

const PriceSchema = z.union([z.string(), z.number()]).optional();
const CatalogSchema = z.object({
  data: z.array(z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    context_length: z.number().nonnegative().nullable().optional(),
    pricing: z.object({
      prompt: PriceSchema,
      completion: PriceSchema,
    }).optional(),
  })),
});

type UpstreamModel = z.infer<typeof CatalogSchema>['data'][number];

export interface OpenRouterModelSummary {
  id: string;
  name: string;
  provider: string;
  contextLength: number | null;
  promptPricePerMillion: number | null;
  completionPricePerMillion: number | null;
  free: boolean;
  recommended: boolean;
}

let cache: { expiresAt: number; models: UpstreamModel[] } | null = null;

function pricePerMillion(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed * 1_000_000 : null;
}

export function resetOpenRouterModelCacheForTests(): void {
  cache = null;
}

async function loadCatalog(): Promise<UpstreamModel[]> {
  if (cache && cache.expiresAt > Date.now()) return cache.models;

  const response = await axios.get(CATALOG_URL, {
    params: { output_modalities: 'text' },
    timeout: 8_000,
  });
  const parsed = CatalogSchema.safeParse(response.data);
  if (!parsed.success) throw new Error('Invalid OpenRouter model catalog');

  cache = {
    models: parsed.data.data,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  return cache.models;
}

export async function listOpenRouterModels(query = ''): Promise<{
  models: OpenRouterModelSummary[];
  total: number;
}> {
  const upstream = await loadCatalog();
  const recommendedIds = getRecommendedOpenRouterModelIds();
  const recommendationRank = new Map(recommendedIds.map((id, index) => [id, index]));
  const availableIds = new Set(upstream.map((model) => model.id));

  for (const id of recommendedIds) {
    if (!availableIds.has(id)) {
      console.warn(`[OpenRouter] Recommended model is unavailable: ${id}`);
    }
  }

  const normalized = upstream.map((model) => {
    const promptPricePerMillion = pricePerMillion(model.pricing?.prompt);
    const completionPricePerMillion = pricePerMillion(model.pricing?.completion);

    return {
      id: model.id,
      name: model.name || model.id,
      provider: model.id.split('/')[0] || 'openrouter',
      contextLength: model.context_length ?? null,
      promptPricePerMillion,
      completionPricePerMillion,
      free: model.id.endsWith(':free')
        || (promptPricePerMillion === 0 && completionPricePerMillion === 0),
      recommended: recommendationRank.has(model.id),
    } satisfies OpenRouterModelSummary;
  }).sort((left, right) => {
    const leftRank = recommendationRank.get(left.id);
    const rightRank = recommendationRank.get(right.id);
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    }
    if (left.free !== right.free) return left.free ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle
    ? normalized.filter((model) => (
      `${model.name} ${model.id} ${model.provider}`.toLocaleLowerCase().includes(needle)
    ))
    : normalized;

  return {
    models: filtered.slice(0, RESULT_LIMIT),
    total: filtered.length,
  };
}
