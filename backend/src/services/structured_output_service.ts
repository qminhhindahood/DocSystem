/**
 * Structured Output Service
 * Enforces JSON Schema output through the user's configured provider.
 */

import { callLLM, getLLMConfig } from './llm_config_service';
import {
  buildDocumentFieldJsonSchema,
  getTemplateFields,
} from './template_service';

export interface StructuredOutputRequest {
  prompt: string;
  docType?: string; // Build schema from this template type
  schema?: object; // Custom JSON Schema (overrides docType)
  model?: string; // Optional override for the configured provider model
  systemPrompt?: string; // Custom system instruction
  temperature?: number; // Default: 0.1
  maxTokens?: number; // Default: 4000
  strict?: boolean; // Enable strict mode, default: true
  userId?: string; // Per-user LLM config
  signal?: AbortSignal;
}

export interface StructuredOutputResponse {
  data: any;
  model: string;
  usage?: { tokens: number };
  raw?: string; // Only included on error if debug=true
}

const promptOnlyStructuredModels = new Set<string>();

export function resetStructuredOutputCapabilityCache(): void {
  promptOnlyStructuredModels.clear();
}

function capabilityKey(provider: string, model: string): string {
  return `${provider}:${model}`;
}

function rejectsNativeStructuredOutput(error: unknown): boolean {
  return error instanceof Error && /LLM error (?:400|404|422)\b/.test(error.message);
}

/**
 * Build JSON Schema from DocumentField definitions
 */
export function buildSchemaFromTemplate(docType: string): object {
  const fields = getTemplateFields(docType);

  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const field of fields) {
    if (field.required) {
      required.push(field.name);
    }

    properties[field.name] = buildDocumentFieldJsonSchema(field);
  }

  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * Build block/name/space schema for DOCX structure
 */
export function buildDocxBlockSchema(): object {
  return {
    type: 'object',
    properties: {
      document: {
        type: 'object',
        properties: {
          header: {
            type: 'object',
            properties: {
              ministry: { type: 'string' },
              republic: { type: 'string' },
              documentNumber: { type: 'string' },
              documentDate: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['ministry', 'republic', 'documentNumber', 'title'],
          },
          blocks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: {
                  type: 'string',
                  enum: [
                    'heading1',
                    'heading4',
                    'heading6',
                    'paragraph',
                    'list',
                    'clause',
                    'point',
                    'table',
                  ],
                },
                style: { type: 'string' },
                name: { type: 'string' },
                content: { type: 'string' },
                space: {
                  type: 'object',
                  properties: {
                    indent: { type: 'number' },
                    spacingBefore: { type: 'number' },
                    spacingAfter: { type: 'number' },
                    lineSpacing: { type: 'number' },
                  },
                },
                children: {
                  type: 'array',
                  items: { $ref: '#/properties/blocks/items' },
                },
              },
              required: ['type', 'style', 'content'],
            },
          },
        },
        required: ['blocks'],
      },
    },
    required: ['document'],
  };
}

/**
 * Build system prompt with schema instructions
 */
function buildSystemPrompt(
  schema: object,
  customPrompt?: string
): Array<{ role: string; content: string }> {
  const schemaStr = JSON.stringify(schema, null, 2);

  const baseSystem = `Bạn là trợ lý tạo văn bản hành chính Việt Nam.

QUY TẮC:
- Đầu ra PHẢI là JSON hợp lệ tuân thủ schema dưới đây
- Không thêm bất kỳ văn bản nào khác ngoài JSON
- Đảm bảo đủ trường required theo schema
- Dùng tiếng Việt cho nội dung văn bản

SCHEMA:
${schemaStr}

LƯU Ý:
- Nếu không có thông tin, dùng giá trị mặc định hợp lý
- Với ngày tháng: format "dd/mm/yyyy" (ví dụ: "19/05/2017")
- Đối với trường list/array: đảm bải là mảng, ngay cả khi chỉ có 1 phần tử

Chỉ trả về JSON. Không giải thích.`;

  return [
    { role: 'system', content: baseSystem },
    ...(customPrompt
      ? [{ role: 'user', content: customPrompt }]
      : []),
  ];
}

export class StructuredOutputService {
  /**
   * Generate structured output from a prompt using JSON Schema enforcement
   */
  async generate(
    req: StructuredOutputRequest
  ): Promise<StructuredOutputResponse> {
    // Validate: either docType or schema must be provided
    if (!req.docType && !req.schema) {
      throw new Error('Either docType or schema must be provided');
    }
    if ((req.maxTokens ?? 4000) < 1 || (req.maxTokens ?? 4000) > 8_192) {
      throw new Error('maxTokens must be between 1 and 8192');
    }
    if (req.schema && JSON.stringify(req.schema).length > 50_000) {
      throw new Error('Custom schema is too large');
    }

    // Build schema
    let finalSchema: object;
    if (req.schema) {
      finalSchema = req.schema;
    } else {
      // Build from template
      finalSchema = buildSchemaFromTemplate(req.docType!);
    }

    // Build messages
    const systemPrompt = req.systemPrompt
      ? [{ role: 'system', content: req.systemPrompt }]
      : buildSystemPrompt(finalSchema);

    const messages = [
      ...systemPrompt,
      { role: 'user', content: req.prompt },
    ];

    // Use user's LLM config or fall back to env
    const llmConfig = await getLLMConfig(req.userId);
    const effectiveConfig = req.model ? { ...llmConfig, model: req.model } : llmConfig;

    const requestOptions = {
      temperature: req.temperature ?? 0.1,
      max_tokens: req.maxTokens ?? 4000,
      signal: req.signal,
    };
    const key = capabilityKey(effectiveConfig.provider, effectiveConfig.model);
    const promptOnlyMessages = [
      {
        role: 'system',
        content: `The provider does not enforce JSON Schema natively. Return only JSON matching this schema: ${JSON.stringify(finalSchema)}`,
      },
      ...messages,
    ];

    let raw: string;
    if (promptOnlyStructuredModels.has(key)) {
      raw = await callLLM(effectiveConfig, promptOnlyMessages, requestOptions);
    } else {
      try {
        raw = await callLLM(effectiveConfig, messages, {
          ...requestOptions,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: `structured_${req.docType || 'custom'}`,
              strict: req.strict !== false,
              schema: finalSchema,
            },
          },
        });
      } catch (error) {
        if (!rejectsNativeStructuredOutput(error)) throw error;
        promptOnlyStructuredModels.add(key);
        raw = await callLLM(effectiveConfig, promptOnlyMessages, requestOptions);
      }
    }

    // Parse JSON
    let data;
    try {
      const normalized = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      data = JSON.parse(normalized);
    } catch (error) {
      // The response can contain private document content. Record only metadata.
      console.error('[structured-output] JSON parse failed', { outputLength: raw.length });
      throw new Error(
        `Failed to parse LLM output as JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }

    return {
      data,
      model: effectiveConfig.model,
    };
  }
}

export const structuredOutputService = new StructuredOutputService();
