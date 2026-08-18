import axios from 'axios';
import type { AnalyzeTemplateInput, AnalyzeTemplateOutput } from '../types/templates';
import type {
  FidelityReport,
  FidelityValidationStatus,
  FidelityWarning,
} from '../types/templates';
import { getCloudRunAuthorization } from '../utils/cloud_run_auth';

const RENDERER_URL = process.env.DOCUMENT_RENDERER_URL || 'http://localhost:8005';
const client = axios.create({
  baseURL: RENDERER_URL,
  timeout: 60_000,
});

async function rendererHeaders(): Promise<Record<string, string>> {
  const rendererToken = process.env.RENDERER_INTERNAL_TOKEN || '';
  return {
    ...(rendererToken ? { 'x-renderer-token': rendererToken } : {}),
    ...await getCloudRunAuthorization(RENDERER_URL),
  };
}

/** POST /internal/templates/analyze — package validation + structural analysis + page rendering. */
export async function analyzeTemplate(input: AnalyzeTemplateInput): Promise<AnalyzeTemplateOutput> {
  const resp = await client.post('/internal/templates/analyze', {
    template_id: input.templateId,
    relative_path: input.relativePath,
    sha256: input.sha256,
  }, { headers: await rendererHeaders() });
  return normalizeAnalyzeTemplateOutput(resp.data);
}

export function normalizeAnalyzeTemplateOutput(raw: unknown): AnalyzeTemplateOutput {
  const data: Record<string, unknown> = asRecord(raw);
  return {
    success: data.success === true,
    documentFingerprint: stringOrUndefined(data.document_fingerprint),
    candidates: Array.isArray(data.candidates) ? data.candidates.map(candidateValue => {
      const candidate = asRecord(candidateValue);
      const kind = stringOrEmpty(candidate.kind);
      return {
        locator: stringOrEmpty(candidate.locator),
        kind,
        fingerprint: isRecord(candidate.fingerprint) ? candidate.fingerprint : null,
        textSnippet: stringOrEmpty(candidate.text_snippet),
        formatting: normalizeCandidateFormatting(candidate.formatting, kind),
      };
    }) : [],
    baselinePages: stringArray(data.baseline_pages),
    labeledPages: stringArray(data.labeled_pages),
    compatibility: stringArray(data.compatibility),
  };
}

function normalizeCandidateFormatting(raw: unknown, kind: string) {
  const formatting = asRecord(raw);
  const styles = Array.isArray(formatting.styles) ? formatting.styles.flatMap(value => {
    const style = asRecord(value);
    const size = style.font_size_points;
    if (typeof style.font_family !== 'string' ||
        (typeof size !== 'number' && size !== null) ||
        typeof style.bold !== 'boolean' ||
        typeof style.italic !== 'boolean' ||
        typeof style.color !== 'string') return [];
    return [{
      fontFamily: style.font_family,
      fontSizePoints: size,
      bold: style.bold,
      italic: style.italic,
      color: style.color,
    }];
  }) : [];
  return {
    inTextBox: typeof formatting.in_text_box === 'boolean'
      ? formatting.in_text_box
      : kind === 'FLOATING_TEXT_BOX',
    styles,
  };
}

export interface RenderTemplateDocumentInput {
  template_id: string;
  owner_id: string;
  document_id: string;
  relative_path: string;
  values: Record<string, unknown>;
  mappings: Array<{ field_name: string; locator: string }>;
}

export interface RenderTemplateDocumentOutput {
  success: boolean;
  output_relative_path?: string;
  output_sha256?: string;
  output_size?: number;
  fidelity_report: FidelityReport;
  shorten_required?: { field: string; max_characters: number };
}

/** Render into an existing template; success means structural verification and publication passed. */
export async function renderTemplateDocument(
  input: RenderTemplateDocumentInput,
  signal?: AbortSignal,
): Promise<RenderTemplateDocumentOutput> {
  const resp = await client.post('/internal/templates/render', input, {
    signal,
    headers: await rendererHeaders(),
  });
  return normalizeRenderTemplateDocumentOutput(resp.data);
}

export function normalizeRenderTemplateDocumentOutput(raw: unknown): RenderTemplateDocumentOutput {
  const data = asRecord(raw);
  const shorten = isRecord(data.shorten_required) ? data.shorten_required : null;
  return {
    success: data.success === true,
    output_relative_path: stringOrUndefined(data.output_relative_path),
    output_sha256: stringOrUndefined(data.output_sha256),
    output_size: numberOrUndefined(data.output_size),
    fidelity_report: normalizeFidelityReport(data.fidelity_report),
    shorten_required: shorten && typeof shorten.field === 'string' && Number.isSafeInteger(shorten.max_characters)
      ? { field: shorten.field, max_characters: Number(shorten.max_characters) }
      : undefined,
  };
}

function normalizeFidelityReport(raw: unknown): FidelityReport {
  const report = asRecord(raw);
  const warnings = Array.isArray(report.warnings)
    ? report.warnings.map(normalizeWarning).filter((warning): warning is FidelityWarning => warning !== null)
    : [];
  const status = normalizeValidationStatus(report.validation_status ?? report.validationStatus);
  return {
    passed: report.passed === true,
    violations: Array.isArray(report.violations) ? report.violations.flatMap(value => {
      const violation = asRecord(value);
      return typeof violation.code === 'string' && typeof violation.message === 'string'
        ? [{ code: violation.code, message: violation.message,
            ...(typeof violation.field === 'string' ? { field: violation.field } : {}) }]
        : [];
    }) : [],
    repairs: Array.isArray(report.repairs) ? report.repairs.flatMap(value => {
      const repair = asRecord(value);
      return typeof repair.policy === 'string' && typeof repair.field === 'string'
        ? [{ policy: repair.policy, field: repair.field }]
        : [];
    }) : [],
    pageCount: Number.isSafeInteger(report.page_count ?? report.pageCount)
      ? Number(report.page_count ?? report.pageCount) : 0,
    warnings,
    validationStatus: status,
  };
}

function normalizeWarning(raw: unknown): FidelityWarning | null {
  const warning = asRecord(raw);
  if (typeof warning.code !== 'string' || typeof warning.message !== 'string') return null;
  const severity = warning.severity;
  if (severity !== 'info' && severity !== 'warning' && severity !== 'high') return null;
  const details = isRecord(warning.details)
    ? Object.fromEntries(Object.entries(warning.details).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string'))
    : undefined;
  return {
    code: warning.code,
    severity,
    message: warning.message,
    ...(typeof warning.field === 'string' ? { field: warning.field } : {}),
    ...(details && Object.keys(details).length ? { details } : {}),
  };
}

function normalizeValidationStatus(value: unknown): FidelityValidationStatus {
  return value === 'passed' || value === 'warnings' || value === 'unavailable' ? value : 'unavailable';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

/** GET /live — health check. */
export async function isRendererAlive(): Promise<boolean> {
  try {
    const resp = await client.get('/live', { timeout: 5_000, headers: await rendererHeaders() });
    return resp.status === 200;
  } catch {
    return false;
  }
}
