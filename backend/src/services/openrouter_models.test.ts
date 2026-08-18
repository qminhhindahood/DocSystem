import axios from 'axios';
import { getRecommendedOpenRouterModelIds } from '../config/openrouter_models';
import {
  listOpenRouterModels,
  resetOpenRouterModelCacheForTests,
} from './openrouter_models';

jest.mock('axios');

const mockedGet = axios.get as jest.MockedFunction<typeof axios.get>;

const upstream = {
  data: {
    data: [
      {
        id: 'paid/model',
        name: 'Paid Model',
        context_length: 32_000,
        pricing: { prompt: '0.000001', completion: '0.000002' },
      },
      {
        id: 'free/model:free',
        name: 'Free Model',
        context_length: 64_000,
        pricing: { prompt: '0', completion: '0' },
      },
      {
        id: 'openrouter/free',
        name: 'Free Models Router',
        context_length: 200_000,
        pricing: { prompt: '0', completion: '0' },
      },
    ],
  },
};

describe('OpenRouter model catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetOpenRouterModelCacheForTests();
    delete process.env.OPENROUTER_RECOMMENDED_MODELS;
  });

  it('uses defaults only when the environment override is absent', () => {
    expect(getRecommendedOpenRouterModelIds(undefined)).toEqual(['openrouter/free']);
    expect(getRecommendedOpenRouterModelIds(' paid/model, free/model:free,paid/model '))
      .toEqual(['paid/model', 'free/model:free']);
    expect(getRecommendedOpenRouterModelIds('')).toEqual([]);
  });

  it('orders recommendations, then free models, then paid models', async () => {
    process.env.OPENROUTER_RECOMMENDED_MODELS = 'paid/model,openrouter/free';
    mockedGet.mockResolvedValue(upstream);

    const result = await listOpenRouterModels();

    expect(result.models.map((model) => model.id)).toEqual([
      'paid/model',
      'openrouter/free',
      'free/model:free',
    ]);
    expect(result.models[0]).toMatchObject({
      recommended: true,
      free: false,
      promptPricePerMillion: 1,
      completionPricePerMillion: 2,
    });
    expect(result.models[1]).toMatchObject({ recommended: true, free: true });
  });

  it('caches upstream data, filters search, and never sends an API key', async () => {
    mockedGet.mockResolvedValue(upstream);

    const first = await listOpenRouterModels('free model');
    const second = await listOpenRouterModels('paid/model');

    expect(first.models.map((model) => model.id)).toEqual(['openrouter/free', 'free/model:free']);
    expect(second.models.map((model) => model.id)).toEqual(['paid/model']);
    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({ params: { output_modalities: 'text' }, timeout: 8_000 }),
    );
    expect(mockedGet.mock.calls[0][1]?.headers).toBeUndefined();
  });

  it('caps rendered search results while reporting the full match count', async () => {
    process.env.OPENROUTER_RECOMMENDED_MODELS = '';
    mockedGet.mockResolvedValue({
      data: {
        data: Array.from({ length: 100 }, (_, index) => ({
          id: `provider/model-${index}`,
          name: `Model ${index}`,
          context_length: 8_192,
          pricing: { prompt: '0.000001', completion: '0.000001' },
        })),
      },
    });

    const result = await listOpenRouterModels('model');

    expect(result.total).toBe(100);
    expect(result.models).toHaveLength(80);
  });

  it('logs unavailable recommendations without exposing them as selectable models', async () => {
    process.env.OPENROUTER_RECOMMENDED_MODELS = 'missing/model,openrouter/free';
    mockedGet.mockResolvedValue(upstream);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await listOpenRouterModels();

    expect(result.models.some((model) => model.id === 'missing/model')).toBe(false);
    expect(warn).toHaveBeenCalledWith('[OpenRouter] Recommended model is unavailable: missing/model');
    warn.mockRestore();
  });

  it('rejects malformed upstream responses', async () => {
    mockedGet.mockResolvedValue({ data: { data: [{ name: 'missing-id' }] } });

    await expect(listOpenRouterModels()).rejects.toThrow('Invalid OpenRouter model catalog');
  });
});
