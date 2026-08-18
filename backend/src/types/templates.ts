export type TemplateStatus = 'UPLOADED' | 'ANALYZING' | 'NEEDS_REVIEW' | 'READY' | 'REJECTED' | 'FAILED';

export interface TemplateSummary {
  id: string;
  name: string;
  docType: string | null;
  status: TemplateStatus;
  analysisConfidence: number | null;
  rejectionCode: string | null;
  rejectionReason: string | null;
  createdAt: string;
  fileSize: number | null;
}

export type FidelityValidationStatus = 'passed' | 'warnings' | 'unavailable';

export interface FidelityWarning {
  code: string;
  severity: 'info' | 'warning' | 'high';
  message: string;
  field?: string;
  details?: Record<string, string>;
}

export interface FidelityReport {
  passed: boolean;
  violations: Array<{ code: string; field?: string; message: string }>;
  repairs: Array<{ policy: string; field: string }>;
  pageCount: number;
  warnings: FidelityWarning[];
  validationStatus: FidelityValidationStatus;
}

export interface ResolvedTextStyle {
  fontFamily: string;
  fontSizePoints: number | null;
  bold: boolean;
  italic: boolean;
  color: string;
}

export interface CandidateFormatting {
  inTextBox: boolean;
  styles: ResolvedTextStyle[];
}

export interface TypographyViolation {
  code: 'FONT_FAMILY_INVALID' | 'FONT_SIZE_INVALID' | 'FONT_WEIGHT_INVALID' |
    'FONT_STYLE_INVALID' | 'FONT_COLOR_INVALID' | 'FONT_FORMAT_UNRESOLVED';
  locator: string;
  field?: string;
  actual: string;
  expected: string;
}

export interface StructuralAnalysis {
  documentFingerprint: string;
  candidates: Array<{
    locator: string;
    kind: string;
    fingerprint: Record<string, unknown> | null;
    textSnippet: string;
    formatting?: CandidateFormatting;
  }>;
  compatibility: string[];
}

export interface AnalyzeTemplateInput {
  templateId: string;
  relativePath: string;
  sha256: string;
}

export interface AnalyzeTemplateOutput {
  success: boolean;
  documentFingerprint?: string;
  candidates?: StructuralAnalysis['candidates'];
  baselinePages?: string[];
  labeledPages?: string[];
  compatibility?: string[];
}
