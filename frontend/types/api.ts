export interface DocumentType {
  id: string;
  name: string;
}

export interface GenerateRequest {
  prompt: string;
  docType?: string;
  documentType?: string;
  referencePdf?: string;
  referenceDocumentId?: string;
  referenceDocumentIds?: string[];
  templateId?: string;
}

export interface GenerateResponse {
  success: boolean;
  outline?: string;
  document?: string;
  researchCount?: number;
}

export interface StreamChunk {
  stage: 'planning' | 'researching' | 'writing' | 'complete' | 'warning';
  message?: string;
  outline?: string;
  count?: number;
  chunk?: string;
  done?: boolean;
  error?: string;
  sources?: unknown[];
  documentId?: string;
  warnings?: string[];
  fidelity?: FidelitySummary;
  formatResult?: string;
  formatResultName?: string;
}

export type FidelityValidationStatus = 'passed' | 'warnings' | 'unavailable';

export interface FidelityWarning {
  code: string;
  severity: 'info' | 'warning' | 'high';
  message: string;
  field?: string;
  details?: Record<string, string>;
}

export interface FidelitySummary {
  validationStatus: FidelityValidationStatus;
  warnings: FidelityWarning[];
}

export interface FidelityReport extends FidelitySummary {
  passed: boolean;
  violations: Array<{ code: string; field?: string; message: string }>;
  repairs: Array<{ policy: string; field: string }>;
  pageCount: number;
}

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

export interface TemplateInfo {
  name: string;
  article: string;
  header: string;
  sections: string[];
  content: string;
}

export interface DocumentField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'select' | 'list' | 'number' | 'boolean' | 'object-list' | 'table';
  required: boolean;
  description?: string;
  defaultValue?: string;
  options?: string[];
  itemProperties?: Record<string, {
    type: 'string' | 'number' | 'boolean';
    label: string;
    required?: boolean;
  }>;
}

// ============================================================================
// Feedback Types
// ============================================================================

export type EditType = 'addition' | 'deletion' | 'modification';
export type FeedbackSubType = 'formatting' | 'wording' | 'structural' | 'legal' | 'correction';
export type FeedbackPriority = 'critical' | 'high' | 'medium' | 'low';

export interface FeedbackSubmission {
  documentId?: string;
  originalContent: string;
  editedContent: string;
  docType: string;
}

// ============================================================================
// Document types
// ============================================================================

export interface DocumentListItem {
  id: string;
  docType: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count: { chunks: number; feedback: number };
}

export interface DocumentDetail extends DocumentListItem {
  content: string;
  chunks: Array<{ id: string; content: string; level: number }>;
  feedback: unknown[];
  metadata?: {
    generation?: {
      state?: string;
      outputSha256?: string;
      validationStatus?: FidelityValidationStatus;
      fidelityReport?: FidelityReport;
    };
  } | null;
}

export interface DocumentsListResponse {
  success: boolean;
  data: DocumentListItem[];
  meta: {
    total: number;
    limit: number;
    offset: number;
    pages: number;
  };
}

// ============================================================================
// Q&A Types
// ============================================================================

export type QASource = { id: string; content: string; article?: string; clause?: string };

export interface QAMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  sources?: QASource[];
  lowConfidence?: boolean;
}

export interface QAAnswer {
  answer: string;
  sources: QASource[];
  sourceCount: number;
  lowConfidence?: boolean;
}
