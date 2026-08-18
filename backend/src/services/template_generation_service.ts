/**
 * Template Generation Service — inserts semantic values into a DOCX template,
 * verifies fidelity (no placeholder left unset), and renders preview pages.
 *
 * This is the bridge between the orchestrator's structured JSON output and
 * the user's DOCX template.
 */

import { prisma } from '../utils/prisma';
import { analyzeTemplate } from './template_service_client';
import axios from 'axios';
import type { AccessScope } from '../utils/document_access';
import type { GenerationSchema } from './template_semantics';
import { structuredOutputService } from './structured_output_service';
import { getDocumentProfile, reserveDocumentNumber } from './document_profile_service';
import { renderTemplateDocument } from './template_service_client';
import type { FidelityReport, FidelityWarning } from '../types/templates';
import { getCloudRunAuthorization } from '../utils/cloud_run_auth';

const RENDERER_URL = process.env.DOCUMENT_RENDERER_URL || 'http://localhost:8005';
const rendererClient = axios.create({
  baseURL: RENDERER_URL,
  timeout: 120_000,
});

async function rendererHeaders(): Promise<Record<string, string>> {
  const rendererToken = process.env.RENDERER_INTERNAL_TOKEN || '';
  return {
    ...(rendererToken ? { 'x-renderer-token': rendererToken } : {}),
    ...await getCloudRunAuthorization(RENDERER_URL),
  };
}

export interface RenderResult {
  success: boolean;
  templateId: string;
  insertions: number;
  unsetKeys: string[];
  renderedPages: string[];
  verifications: Record<string, boolean>;
}

export interface OverflowRepairResult {
  repaired: boolean;
  overflowFields: string[];
  originalPages: number;
  maxPages: number;
  suggestion: string | null;
}

export interface TemplateGenerationInput {
  ownerId: string;
  templateId: string;
  prompt: string;
  referenceDocumentIds?: string[];
  signal?: AbortSignal;
}

export interface TemplateGenerationResult {
  documentId: string;
  content: string;
  storageKey: string;
  outputSha256: string;
  fidelityReport: FidelityReport;
}

type JsonSchema = {
  type?: string;
  properties?: Record<string, { type?: string }>;
  required?: string[];
  additionalProperties?: boolean;
};

function strictSchemaFromGenerationSchema(stored: unknown): JsonSchema {
  const generation = stored as (GenerationSchema & { jsonSchema?: JsonSchema }) | null;
  if (generation?.jsonSchema) {
    if (generation.jsonSchema.additionalProperties !== false) {
      throw Object.assign(new Error('Template generation schema is not strict'), { statusCode: 409 });
    }
    return generation.jsonSchema;
  }

  if (!generation?.fields?.length) {
    throw Object.assign(new Error('Template has no compiled generation schema'), { statusCode: 409 });
  }
  const properties = Object.fromEntries(generation.fields.map(field => [
    field.name,
    { type: field.type === 'list' ? 'array' : 'string' },
  ]));
  return { type: 'object', properties, required: [], additionalProperties: false };
}

function validateSemanticValues(schema: JsonSchema, candidate: unknown): Record<string, unknown> {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new Error('Model output must be a JSON object');
  }
  const values = candidate as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const unknown = Object.keys(values).find(key => !(key in properties));
  if (unknown) throw new Error(`Model output contains unknown field: ${unknown}`);
  for (const required of schema.required ?? []) {
    if (!(required in values)) throw new Error(`Model output is missing required field: ${required}`);
  }
  for (const [key, value] of Object.entries(values)) {
    const expected = properties[key]?.type;
    if (expected === 'array' && !Array.isArray(value)) throw new Error(`Field ${key} must be an array`);
    if (expected === 'string' && typeof value !== 'string') throw new Error(`Field ${key} must be a string`);
  }
  return { ...values };
}

function setFirstPresent(
  values: Record<string, unknown>,
  schema: JsonSchema,
  aliases: string[],
  value: unknown,
): void {
  if (value === null || value === undefined || value === '') return;
  const field = aliases.find(alias => alias in (schema.properties ?? {}));
  if (field) values[field] = value;
}

function vietnameseSystemDate(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('day')}/${part('month')}/${part('year')}`;
}

/** Generate and persist one owner-scoped, fidelity-verified template document. */
export async function generateTemplateDocument(
  input: TemplateGenerationInput,
): Promise<TemplateGenerationResult> {
  const template = await prisma.template.findFirst({
    where: { id: input.templateId, ownerId: input.ownerId },
    select: {
      id: true, ownerId: true, status: true, name: true, docType: true,
      originalPath: true, generationSchema: true,
    },
  });
  if (!template) throw Object.assign(new Error('Template not found'), { statusCode: 404 });
  if (template.status !== 'READY') {
    throw Object.assign(new Error('Template is not ready for generation'), { statusCode: 409 });
  }
  if (!template.originalPath) {
    throw Object.assign(new Error('Template original is unavailable'), { statusCode: 409 });
  }
  const originalPath = template.originalPath;

  const schema = strictSchemaFromGenerationSchema(template.generationSchema);
  const storedGeneration = template.generationSchema as unknown as GenerationSchema;
  const rendererMappings = (storedGeneration.fields ?? [])
    .filter(field => Boolean(field.locator))
    .map(field => ({ field_name: field.name, locator: field.locator! }));
  if (rendererMappings.length === 0) {
    throw Object.assign(new Error('Template has no verified renderer mappings'), { statusCode: 409 });
  }
  const referenceIds = [...new Set(input.referenceDocumentIds ?? [])].slice(0, 20);
  const references = referenceIds.length
    ? await prisma.document.findMany({
        where: { id: { in: referenceIds }, ownerId: input.ownerId },
        select: { id: true, title: true, content: true },
      })
    : [];
  const evidence = references
    .map(reference => `[${reference.title}]\n${reference.content.slice(0, 8_000)}`)
    .join('\n\n');
  const generationPrompt = evidence
    ? `${input.prompt}\n\nUse only relevant facts from these owner-scoped references:\n${evidence}`
    : input.prompt;

  let modelData: unknown;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const generated = await structuredOutputService.generate({
        prompt: generationPrompt,
        schema,
        strict: true,
        userId: input.ownerId,
        temperature: 0.1,
        signal: input.signal,
      });
      modelData = validateSemanticValues(schema, generated.data);
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;

  const values = modelData as Record<string, unknown>;
  const [profile, documentNumber] = await Promise.all([
    getDocumentProfile(input.ownerId),
    reserveDocumentNumber(input.ownerId),
  ]);
  setFirstPresent(values, schema, ['supervising_agency'], profile?.supervisingAgency);
  setFirstPresent(values, schema, ['agency_name', 'issuingAgency'], profile?.agencyName);
  setFirstPresent(values, schema, ['agency_address'], profile?.agencyAddress);
  setFirstPresent(values, schema, ['agency_email'], profile?.agencyEmail);
  setFirstPresent(values, schema, ['agency_website'], profile?.agencyWebsite);
  setFirstPresent(values, schema, ['agency_phone'], profile?.agencyPhone);
  setFirstPresent(values, schema, ['place'], profile?.defaultPlace);
  setFirstPresent(values, schema, ['recipient', 'distribution_list', 'distributionList'], profile?.defaultRecipients);
  setFirstPresent(values, schema, ['signatory_name', 'signatoryName'], profile?.signatoryName);
  setFirstPresent(values, schema, ['signatory_title', 'signatoryTitle'], profile?.signatoryTitle);
  setFirstPresent(values, schema, ['date_vn', 'date'], vietnameseSystemDate());
  setFirstPresent(values, schema, ['document_number', 'documentNumber'], documentNumber);
  validateSemanticValues(schema, values);

  const content = JSON.stringify(values, null, 2);
  const subject = values.subject;
  const document = await prisma.document.create({
    data: {
      ownerId: input.ownerId,
      docType: template.docType ?? 'template',
      title: typeof subject === 'string' && subject.trim() ? subject.trim() : template.name,
      content,
      status: 'draft',
      ingestionStatus: 'uploaded',
      storageKey: null,
      originalFilename: `${template.name}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      metadata: {
        generation: { state: 'rendering', templateId: template.id },
      },
    },
    select: { id: true },
  });

  try {
    const render = () => renderTemplateDocument({
      template_id: template.id,
      owner_id: input.ownerId,
      document_id: document.id,
      relative_path: originalPath,
      values,
      mappings: rendererMappings,
    }, input.signal);
    const expectedPath = `generated/${input.ownerId}/${document.id}.docx`;
    const firstValidRender = await render();
    if (!isValidDeliverable(firstValidRender, expectedPath)) {
      throw Object.assign(new Error('Rendered document failed fidelity verification'), {
        statusCode: 422,
        fidelityReport: firstValidRender.fidelity_report,
      });
    }
    let rendered = firstValidRender;
    if (firstValidRender.shorten_required) {
      try {
        const { field } = firstValidRender.shorten_required;
        const maxCharacters = Math.max(1, Math.min(firstValidRender.shorten_required.max_characters, 5_000));
        if (!(field in (schema.properties ?? {}))) {
          throw new Error('Renderer requested shortening for an unknown field');
        }
        const shorteningSchema = {
          type: 'object',
          properties: { [field]: { type: 'string', maxLength: maxCharacters } },
          required: [field],
          additionalProperties: false,
        };
        const shortened = await structuredOutputService.generate({
          prompt: `Shorten only this field to at most ${maxCharacters} characters while preserving its meaning:\n${String(values[field] ?? '')}`,
          schema: shorteningSchema,
          strict: true,
          userId: input.ownerId,
          temperature: 0.1,
          signal: input.signal,
        });
        const shortenedValues = validateSemanticValues(shorteningSchema, shortened.data);
        if (typeof shortenedValues[field] !== 'string' || shortenedValues[field].length > maxCharacters) {
          throw new Error('Shortening response violated the renderer limit');
        }
        values[field] = shortenedValues[field];
        const secondRender = await render();
        if (!isValidDeliverable(secondRender, expectedPath)) throw new Error('Shortened render was invalid');
        rendered = secondRender;
      } catch {
        rendered = {
          ...firstValidRender,
          fidelity_report: appendFidelityWarning(firstValidRender.fidelity_report, {
            code: 'SHORTENING_FAILED',
            severity: 'warning',
            message: 'Optional content shortening failed; the first structurally valid document was retained.',
          }),
        };
      }
    }

    await prisma.document.updateMany({
      where: { id: document.id, ownerId: input.ownerId },
      data: {
        storageKey: rendered.output_relative_path,
        fileSize: rendered.output_size ?? 0,
        metadata: JSON.parse(JSON.stringify({
          generation: {
            state: 'verified', templateId: template.id,
            outputSha256: rendered.output_sha256,
            validationStatus: rendered.fidelity_report.validationStatus,
            fidelityReport: rendered.fidelity_report,
          },
        })),
      },
    });
    return {
      documentId: document.id,
      content,
      storageKey: rendered.output_relative_path!,
      outputSha256: rendered.output_sha256!,
      fidelityReport: rendered.fidelity_report,
    };
  } catch (error) {
    await prisma.document.updateMany({
      where: { id: document.id, ownerId: input.ownerId },
      data: {
        storageKey: null,
        metadata: {
          generation: {
            state: 'failed', templateId: template.id,
            code: (error as { statusCode?: number }).statusCode === 422 ? 'FIDELITY_FAILED' : 'RENDER_FAILED',
          },
        },
      },
    });
    throw error;
  }
}

function isValidDeliverable(
  rendered: Awaited<ReturnType<typeof renderTemplateDocument>>,
  expectedPath: string,
): boolean {
  return rendered.success
    && rendered.output_relative_path === expectedPath
    && /^[a-f0-9]{64}$/i.test(rendered.output_sha256 ?? '')
    && Number.isSafeInteger(rendered.output_size)
    && (rendered.output_size ?? 0) > 0;
}

function appendFidelityWarning(report: FidelityReport, warning: FidelityWarning): FidelityReport {
  return {
    ...report,
    passed: false,
    validationStatus: report.validationStatus === 'unavailable' ? 'unavailable' : 'warnings',
    warnings: [...report.warnings, warning],
  };
}

/**
 * Insert values into a template and render previews.
 */
export async function renderTemplate(
  templateId: string,
  ownerId: string,
  values: Record<string, string>,
): Promise<RenderResult> {
  const template = await prisma.template.findFirst({
    where: { id: templateId, ownerId },
    select: { id: true, ownerId: true, originalPath: true, generationSchema: true },
  });
  if (!template) throw Object.assign(new Error('Template not found'), { statusCode: 404 });

  if (!template.originalPath) {
    throw Object.assign(new Error('Template has no original file'), { statusCode: 400 });
  }

  const resp = await rendererClient.post('/internal/templates/render', {
    template_id: templateId,
    relative_path: template.originalPath,
    values,
  }, { headers: await rendererHeaders() });

  return {
    success: resp.data.success,
    templateId: resp.data.template_id,
    insertions: resp.data.insertions,
    unsetKeys: resp.data.unset_keys,
    renderedPages: resp.data.rendered_pages,
    verifications: resp.data.verifications,
  };
}

/**
 * Check for overflow — page count exceeding the template's expected range.
 * Returns a repair suggestion if the document overflows.
 */
export async function checkOverflow(
  templateId: string,
  ownerId: string,
  renderedPages: string[],
): Promise<OverflowRepairResult> {
  const template = await prisma.template.findFirst({
    where: { id: templateId, ownerId },
    select: { generationSchema: true },
  });
  if (!template) throw Object.assign(new Error('Template not found'), { statusCode: 404 });

  const schema = template.generationSchema as GenerationSchema | null;
  const maxPages = schema?.metadata?.pageCountEstimate
    ? Math.max(schema.metadata.pageCountEstimate * 2, schema.metadata.pageCountEstimate + 3)
    : 5;
  const actualPages = renderedPages.length;

  if (actualPages <= maxPages) {
    return { repaired: false, overflowFields: [], originalPages: schema?.metadata?.pageCountEstimate ?? 1, maxPages, suggestion: null };
  }

  return {
    repaired: false,
    overflowFields: [],
    originalPages: schema?.metadata?.pageCountEstimate ?? 1,
    maxPages,
    suggestion: actualPages > maxPages
      ? `Document is ${actualPages} pages (expected ≤${maxPages}). Consider condensing field values.`
      : null,
  };
}

/**
 * Verify fidelity: check that no template placeholders remain unset in a rendered result.
 */
export function checkFidelity(verifications: Record<string, boolean>): {
  passed: boolean;
  violations: Array<{ code: string; field?: string; message: string }>;
} {
  const unset = Object.entries(verifications)
    .filter(([, filled]) => !filled)
    .map(([key]) => ({ code: 'UNSET_FIELD', field: key, message: `Field "${key}" was not filled in the template` }));

  return {
    passed: unset.length === 0,
    violations: unset,
  };
}
