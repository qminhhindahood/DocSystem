import { readFileSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { callLLMVision, getLLMConfig } from './llm_config_service';
import type { StructuralAnalysis } from '../types/templates';
import type { FieldMapping } from './template_semantics';

const TEMPLATE_STORAGE_DIR = process.env.TEMPLATE_STORAGE_DIR || resolve(__dirname, '../../uploads/templates');
const VisionMapSchema = z.object({
  documentKind: z.string().min(1),
  confidence: z.number().min(0).max(1),
  fields: z.record(z.object({
    locator: z.string().min(1),
    confidence: z.number().min(0).max(1),
    cardinality: z.enum(['one', 'optional', 'many']),
    valueType: z.enum(['string', 'date', 'stringArray', 'sectionArray', 'person']),
    overflowPolicy: z.enum(['linkedFrame', 'expand', 'tighten', 'shorten', 'fail']),
  })),
});

const responseSchema = {
  type: 'object',
  properties: {
    documentKind: { type: 'string' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    fields: {
      type: 'object', additionalProperties: {
        type: 'object',
        properties: {
          locator: { type: 'string' }, confidence: { type: 'number', minimum: 0, maximum: 1 },
          cardinality: { type: 'string', enum: ['one', 'optional', 'many'] },
          valueType: { type: 'string', enum: ['string', 'date', 'stringArray', 'sectionArray', 'person'] },
          overflowPolicy: { type: 'string', enum: ['linkedFrame', 'expand', 'tighten', 'shorten', 'fail'] },
        },
        required: ['locator', 'confidence', 'cardinality', 'valueType', 'overflowPolicy'],
        additionalProperties: false,
      },
    },
  },
  required: ['documentKind', 'confidence', 'fields'], additionalProperties: false,
};

function readPreview(templateId: string, relativePath: string): string {
  const labeledPrefix = `previews/${templateId}/labeled/`;
  const baselinePrefix = `previews/${templateId}/baseline/`;
  if ((!relativePath.startsWith(labeledPrefix) && !relativePath.startsWith(baselinePrefix)) || relativePath.includes('..')) throw new Error('Unsafe preview path');
  const root = resolve(TEMPLATE_STORAGE_DIR);
  const path = resolve(root, ...relativePath.split('/'));
  if (!path.startsWith(`${root}${sep}`)) throw new Error('Preview escapes template storage');
  if (statSync(path).size > 12 * 1024 * 1024) throw new Error('Preview image is too large');
  return `data:image/png;base64,${readFileSync(path).toString('base64')}`;
}

export async function mapTemplateWithVision(input: {
  templateId: string;
  ownerId: string;
  analysis: StructuralAnalysis;
  baselinePages: string[];
  labeledPages: string[];
  structuralMappings: FieldMapping[];
  signal?: AbortSignal;
}): Promise<{ mappings: FieldMapping[]; overallConfidence: number }> {
  const locators = new Set(input.analysis.candidates.map(candidate => candidate.locator));
  const candidateText = input.analysis.candidates.slice(0, 500).map((candidate, index) => ({
    label: `C${String(index + 1).padStart(3, '0')}`,
    locator: candidate.locator,
    kind: candidate.kind,
    text: candidate.textSnippet.replace(/[\u0000-\u001f]/g, ' ').slice(0, 200),
  }));
  const previewPages = input.labeledPages.flatMap((page, index) => [page, input.baselinePages[index]])
    .filter((page): page is string => Boolean(page));
  const images = previewPages.slice(0, 6).map(page => readPreview(input.templateId, page));
  if (images.length === 0) throw new Error('Vision mapping requires labeled page renders');
  const config = await getLLMConfig(input.ownerId);
  const raw = await callLLMVision(config, {
    prompt: `Map Vietnamese administrative-document semantic fields to exact renderer locators. Never invent a locator. Candidates:\n${JSON.stringify(candidateText)}`,
    imageDataUrls: images,
    responseSchema,
  }, input.signal);
  const parsed = VisionMapSchema.parse(JSON.parse(raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()));
  const structuralByField = new Map(input.structuralMappings.map(mapping => [mapping.fieldName, mapping]));
  const mappings: FieldMapping[] = [];
  for (const [fieldName, vision] of Object.entries(parsed.fields)) {
    if (!locators.has(vision.locator)) throw new Error('Vision model returned an unknown renderer locator');
    const structural = structuralByField.get(fieldName);
    const structuralConfidence = structural?.locator === vision.locator ? 1 : structural?.locator ? 0.5 : 0;
    mappings.push({
      fieldName,
      locator: vision.locator,
      kind: input.analysis.candidates.find(candidate => candidate.locator === vision.locator)!.kind,
      confidence: 0.35 * structuralConfidence + 0.65 * vision.confidence,
    });
  }
  return { mappings, overallConfidence: parsed.confidence };
}
