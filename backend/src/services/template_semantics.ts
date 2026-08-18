/**
 * Template Semantics — bridges structural DOCX locations (locators from the
 * renderer's analyze_document) to semantic field names the generator understands.
 *
 * The user's template has a `semanticMap` column (Json) that records the
 * field-to-locator mapping, and a `generationSchema` column (Json) that is the
 * compiled, resolved version used at generation time.
 */

import { buildDocumentFieldJsonSchema, getTemplateFields, type DocumentField } from './template_service';
import type { StructuralAnalysis } from '../types/templates';

/** A single field-locator binding. */
export interface FieldMapping {
  /** Semantic field name matching DocumentField.name (e.g. "agency_name"). */
  fieldName: string;
  /** DOCX structural locator from the analyzer (e.g. "main/p[5]"). */
  locator: string | null;
  /** Kind of candidate this maps to. */
  kind: string;
  /** 0-1 confidence that auto-detection is correct. */
  confidence: number;
}

/** The stored user-editable mapping. */
export interface SemanticMap {
  version: 1;
  documentFingerprint: string;
  mappings: FieldMapping[];
  /** Candidates the user has explicitly marked as not-semantic. */
  ignoredLocators: string[];
}

/** Compiled generation schema, resolved for the generator's use. */
export interface GenerationSchema {
  documentFingerprint: string;
  jsonSchema: {
    type: 'object';
    properties: Record<string, Record<string, unknown>>;
    required: string[];
    additionalProperties: false;
  };
  fields: Array<{
    name: string;
    label: string;
    type: DocumentField['type'];
    locator: string | null;
    kind: string;
    confidence: number;
    defaultValue: string;
    textSnippet: string;
  }>;
  unmappedCandidates: Array<{
    locator: string;
    kind: string;
    textSnippet: string;
  }>;
  metadata: {
    pageCountEstimate: number;
    compatibility: string[];
    hasAlternateContent: boolean;
    candidateCount: number;
  };
}

/** Known Vietnamese placeholders grouped by doc type. */
const PLACEHOLDER_PATTERNS: Record<string, RegExp[]> = {
  supervising_agency: [
    /cơ\s+quan\s+chủ\s+quản/i,
    /ủy\s+ban\s+nhân\s+dân/i,
  ],
  agency_name: [
    /TÊN\s+CƠ\s+QUAN/i,
    /cơ\s+quan\s+ban\s+hành/i,
    /CƠ\s+QUAN\s+CÓ\s+THẨM\s+QUYỀN/i,
    /BỘ\s+[A-ZÀ-Ỹ]+/,
    /ỦY\s+BAN/i,
  ],
  document_number: [
    /Số:\s*\.\.\./,
    /số\s+hiệu/i,
    /SỐ\s*:\s*\.\.\./,
  ],
  place: [
    /[Tt]ên\s+địa\s+phương/,
    /Hà\s+Nội/i,
    /Thành\s+Phố\s+Hồ\s+Chí\s+Minh/i,
  ],
  date_vn: [
    /ngày\s+\.\.\.\s+tháng\s+\.\.\.\s+năm\s+\.\.\./,
    /ngày\s+\d+\s+tháng\s+\d+\s+năm/i,
    /\.\.\.\s*\/\s*\.\.\.\s*\/\s*\.\.\./,
  ],
  subject: [
    /[Vv]\/v\s/,
    /trích\s+yếu/i,
    /nội\s+dung/i,
  ],
  signatory_name: [
    /KÝ,\s*GHI\s+RÕ\s+HỌ/i,
    /họ\s+và\s+tên/i,
    /người\s+ký/i,
    /KÝ\s+GHI\s+RÕ/i,
  ],
  signatory_title: [
    /chức\s+vụ/i,
    /BỘ\s+TRƯỞNG/,
    /CHỦ\s+TỊCH/,
    /THỦ\s+TRƯỞNG/,
    /TM\.\s/,
  ],
  recipient: [
    /Kính\s+gửi/i,
    /nơi\s+nhận/i,
    /kính\s+gửi/i,
  ],
  legal_basis: [
    /Căn\s+cứ/i,
    /căn\s+cứ\s+pháp\s+lý/i,
  ],
  content_items: [
    /Nội\s+dung/i,
    /thông\s+báo/i,
  ],
  distribution_list: [
    /Nơi\s+nhận/i,
    /Lưu:\s*VT/i,
  ],
  appendices: [
    /Phụ\s+lục/i,
    /ban\s+hành\s+kèm\s+theo/i,
  ],
  security_level: [
    /TUYỆT\s+MẬT|TỐI\s+MẬT|MẬT/,
  ],
  urgency_level: [
    /HỎA\s+TỐC|THƯỢNG\s+KHẨN|KHẨN/,
  ],
  circulation_instructions: [
    /XEM\s+XONG\s+TRẢ\s+LẠI|KHÔNG\s+PHỔ\s+BIẾN|LƯU\s+HÀNH\s+NỘI\s+BỘ/i,
  ],
  drafter_code: [
    /Lưu:\s*VT,?\s*[A-ZÀ-Ỹ&-]+/,
  ],
  copy_count: [
    /bản\s+phát\s+hành|số\s+lượng\s+bản/i,
  ],
  agency_address: [/Địa\s+chỉ:/i],
  agency_email: [/E-?mail:|Thư\s+điện\s+tử:/i],
  agency_website: [/https?:\/\/|www\.|Trang\s+thông\s+tin/i],
  agency_phone: [/Điện\s+thoại:|ĐT:/i],
  signatories: [/ĐẠI\s+DIỆN\s+BÊN|BÊN\s+A|BÊN\s+B/],
};

/** Score a candidate paragraph against a set of patterns. */
function scorePlaceholder(text: string, patterns: RegExp[]): number {
  let score = 0;
  for (const p of patterns) {
    if (p.test(text)) {
      score += text.length < 200 ? 0.6 : 0.3;
    }
  }
  return Math.min(score, 1);
}

/**
 * Auto-detect field mappings from structural analysis data.
 * Uses pattern matching against candidate text snippets.
 */
export function autoDetectMappings(
  docType: string | null,
  analysis: StructuralAnalysis,
): FieldMapping[] {
  const fields = docType ? getTemplateFields(docType) : [];
  const knownFields = new Map(fields.map(f => [f.name, f]));
  const mappings: FieldMapping[] = [];

  for (const [fieldName, patterns] of Object.entries(PLACEHOLDER_PATTERNS)) {
    let best: { locator: string; kind: string; confidence: number } | null = null;

    for (const c of analysis.candidates) {
      const score = scorePlaceholder(c.textSnippet, patterns);
      if (score > 0 && (!best || score > best.confidence)) {
        best = { locator: c.locator, kind: c.kind, confidence: score };
      }
    }

    const df = knownFields.get(fieldName) || fields.find(f => f.name === fieldName);
    mappings.push({
      fieldName,
      locator: best?.locator ?? null,
      kind: best?.kind ?? 'UNKNOWN',
      confidence: best?.confidence ?? 0,
    });
    // If we have a default value from the template definition, attach it
    if (df?.defaultValue && best) {
      // default carried through at compile time
    }
  }

  return mappings;
}

/**
 * Compile a SemanticMap + StructuralAnalysis into a GenerationSchema.
 * This is what gets stored in the Template's `generationSchema` column.
 */
export function compileGenerationSchema(
  semanticMap: SemanticMap,
  analysis: StructuralAnalysis,
  docType: string | null,
): GenerationSchema {
  const fields = docType ? getTemplateFields(docType) : [];
  const fieldMap = new Map(fields.map(f => [f.name, f]));

  const mappedLocators = new Set<string>();
  const compiledFields = semanticMap.mappings.map((m) => {
    if (m.locator) mappedLocators.add(m.locator);
    const df = fieldMap.get(m.fieldName);
    const candidate = analysis.candidates.find(c => c.locator === m.locator);
    return {
      name: m.fieldName,
      label: df?.label ?? m.fieldName,
      type: df?.type ?? 'text' as DocumentField['type'],
      locator: m.locator,
      kind: m.kind,
      confidence: m.confidence,
      defaultValue: df?.defaultValue ?? '',
      textSnippet: candidate?.textSnippet ?? '',
    };
  });

  const ignored = new Set(semanticMap.ignoredLocators);
  const unmappedCandidates = analysis.candidates
    .filter(c => !mappedLocators.has(c.locator) && !ignored.has(c.locator))
    .map(c => ({
      locator: c.locator,
      kind: c.kind,
      textSnippet: c.textSnippet,
    }));

  const hasAlternateContent = analysis.compatibility.some(
    c => c.includes('AlternateContent'),
  );

  const properties = Object.fromEntries(compiledFields.map(compiledField => {
    const definition = fieldMap.get(compiledField.name);
    return [compiledField.name, definition
      ? buildDocumentFieldJsonSchema(definition)
      : { type: 'string' }];
  }));
  const required = fields
    .filter(field => field.required && properties[field.name])
    .map(field => field.name);

  return {
    documentFingerprint: semanticMap.documentFingerprint,
    jsonSchema: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
    fields: compiledFields,
    unmappedCandidates,
    metadata: {
      pageCountEstimate: Math.max(1, analysis.candidates.filter(c => c.kind === 'BODY_PARAGRAPH').length / 20),
      compatibility: analysis.compatibility,
      hasAlternateContent,
      candidateCount: analysis.candidates.length,
    },
  };
}
