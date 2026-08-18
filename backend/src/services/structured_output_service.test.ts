const mockGetLLMConfig = jest.fn();
const mockCallLLM = jest.fn();

jest.mock('./llm_config_service', () => ({
  getLLMConfig: (...args: unknown[]) => mockGetLLMConfig(...args),
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

jest.mock('./template_service', () => ({
  buildDocumentFieldJsonSchema: jest.fn(),
  getTemplateFields: jest.fn(() => []),
}));

import {
  resetStructuredOutputCapabilityCache,
  structuredOutputService,
} from './structured_output_service';

describe('structured output provider capabilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStructuredOutputCapabilityCache();
    mockGetLLMConfig.mockResolvedValue({
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: 'provider/prompt-only:free',
      apiKey: 'secret',
    });
  });

  it('falls back to schema-in-prompt JSON and caches a native-schema rejection', async () => {
    mockCallLLM
      .mockRejectedValueOnce(new Error('LLM error 400: Provider returned error'))
      .mockResolvedValueOnce('```json\n{"ok":true}\n```')
      .mockResolvedValueOnce('{"ok":true}');

    const request = {
      prompt: 'Return ok.',
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
        required: ['ok'],
        additionalProperties: false,
      },
      userId: 'user-1',
    };
    await expect(structuredOutputService.generate(request)).resolves.toMatchObject({ data: { ok: true } });
    expect(mockCallLLM.mock.calls[0][2]).toHaveProperty('response_format');
    expect(mockCallLLM.mock.calls[1][2]).not.toHaveProperty('response_format');

    await expect(structuredOutputService.generate(request)).resolves.toMatchObject({ data: { ok: true } });
    expect(mockCallLLM).toHaveBeenCalledTimes(3);
    expect(mockCallLLM.mock.calls[2][2]).not.toHaveProperty('response_format');
  });

  it('does not hide authentication, quota, or server failures', async () => {
    mockCallLLM.mockRejectedValue(new Error('LLM error 401: invalid key'));
    await expect(structuredOutputService.generate({
      prompt: 'Return ok.',
      schema: { type: 'object' },
      userId: 'user-1',
    })).rejects.toThrow('401');
    expect(mockCallLLM).toHaveBeenCalledTimes(1);
  });
});
