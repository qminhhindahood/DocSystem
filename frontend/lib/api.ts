/**
 * API Client for AI Document System
 *
 * All requests route through the server-side proxy at /api/proxy/[...path]
 * which validates targets against a configured allowlist. This eliminates
 * the need for NEXT_PUBLIC_API_URL in the client bundle (C3 fix).
 *
 * Auth is handled by the HttpOnly session cookie (docai_session) — no
 * client-side token is needed or stored.
 */

import { parseSSE, SSEEvent } from '@/lib/sse';

const API_BASE = '/api/proxy';

import type {
  DocumentType,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  FidelityValidationStatus,
  FidelityWarning,
  FidelitySummary,
  FidelityReport,
  ValidationResult,
  TemplateInfo,
  DocumentField,
  EditType,
  FeedbackSubType,
  FeedbackPriority,
  FeedbackSubmission,
  DocumentListItem,
  DocumentDetail,
  DocumentsListResponse,
  QASource,
  QAMessage,
  QAAnswer,
} from "@/types/api";

export type {
  DocumentType,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  FidelityValidationStatus,
  FidelityWarning,
  FidelitySummary,
  FidelityReport,
  ValidationResult,
  TemplateInfo,
  DocumentField,
  EditType,
  FeedbackSubType,
  FeedbackPriority,
  FeedbackSubmission,
  DocumentListItem,
  DocumentDetail,
  DocumentsListResponse,
  QASource,
  QAMessage,
  QAAnswer,
};

// ============================================================================
// API Functions — Document Workflow
// ============================================================================

export async function getDocumentTypes(): Promise<DocumentType[]> {
  const response = await fetch(`${API_BASE}/workflow/types`);
  if (!response.ok) {
    throw new Error(`Failed to fetch document types: ${response.statusText}`);
  }
  const data = await response.json();
  return data.types;
}

export async function getTemplateFields(documentType: string): Promise<{ success: boolean; documentType: string; fields: DocumentField[] }> {
  const response = await fetch(`${API_BASE}/workflow/fields/${documentType}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch template fields: ${response.statusText}`);
  }
  return response.json();
}

export async function extractFields(
  prompt: string,
  docType: string,
): Promise<{ success: boolean; docType: string; fields: Record<string, string> }> {
  const response = await fetch(`${API_BASE}/workflow/extract-fields`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, docType }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Field extraction failed: ${response.statusText}`);
  }
  return response.json();
}

export async function getTemplate(documentType: string): Promise<TemplateInfo> {
  const response = await fetch(`${API_BASE}/workflow/template/${documentType}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch template: ${response.statusText}`);
  }
  const data = await response.json();
  return data.template;
}

/**
 * Stream document generation, abort-safe via AbortSignal.
 * Requires templateId for template-based generation.
 */
export async function* generateDocument(
  request: GenerateRequest,
  signal?: AbortSignal,
): AsyncGenerator<StreamChunk> {
  const docType = request.docType ?? request.documentType;
  const response = await fetch(`${API_BASE}/workflow/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ ...request, docType }),
  });

  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }

  if (!response.body) throw new Error('No response body');

  for await (const evt of parseSSE(response.body, signal)) {
    if (evt.event === 'done') {
      yield { stage: 'complete', done: true };
      return;
    }
    if (evt.data !== null) yield evt.data as StreamChunk;
  }
}

export async function generateDocumentNonStreaming(
  request: GenerateRequest,
): Promise<GenerateResponse> {
  const docType = request.docType ?? request.documentType;
  const response = await fetch(`${API_BASE}/workflow/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...request, docType }),
  });
  if (!response.ok) {
    throw new Error(`API Error: ${response.statusText}`);
  }
  return response.json();
}

export async function validateDocument(
  content: string,
  documentType: string,
): Promise<ValidationResult> {
  const response = await fetch(`${API_BASE}/workflow/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, docType: documentType }),
  });
  if (!response.ok) {
    throw new Error(`Validation error: ${response.statusText}`);
  }
  return response.json();
}

export async function sendEditFeedback(submission: FeedbackSubmission): Promise<void> {
  const response = await fetch(`${API_BASE}/feedback/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submission),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to submit feedback: ${response.statusText}`);
  }
}

export async function uploadPDF(
  file: File,
  documentType: string,
  signal?: AbortSignal,
): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('docType', documentType);

  const response = await fetch(`${API_BASE}/rag/index`, {
    method: 'POST',
    body: formData,
    signal,
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to upload PDF: ${response.statusText}`);
  }
  const data = await response.json();
  return data.documentId;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// ============================================================================
// API Functions — Documents
// ============================================================================

export async function listDocuments(
  filters: {
    docType?: string;
    status?: string;
    limit?: number;
    offset?: number;
    q?: string;
  } = {},
): Promise<DocumentsListResponse> {
  const params = new URLSearchParams();
  if (filters.docType) params.set('docType', filters.docType);
  if (filters.status) params.set('status', filters.status);
  if (filters.limit) params.set('limit', filters.limit.toString());
  if (filters.offset) params.set('offset', filters.offset.toString());
  if (filters.q) params.set('q', filters.q);

  const response = await fetch(`${API_BASE}/documents?${params}`);
  if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
  return response.json();
}

export async function getDocument(id: string): Promise<{ success: boolean; data: DocumentDetail }> {
  const response = await fetch(`${API_BASE}/documents/${id}`);
  if (!response.ok) throw new Error(`Failed: ${response.statusText}`);
  return response.json();
}

/**
 * Download a generated document as DOCX with Vietnamese government formatting.
 */
export async function downloadDocumentAsDocx(
  documentId: string,
  title?: string,
): Promise<void> {
  const url = new URL(`${API_BASE}/documents/${documentId}/export-docx`, window.location.origin);
  if (title) url.searchParams.set('title', title);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`Failed to export DOCX: ${response.statusText}`);
  }

  const blob = await response.blob();
  const downloadUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = title ? `${title}.docx` : `document_${documentId}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(downloadUrl);
}

// ============================================================================
// API Functions — Q&A (abort-safe)
// ============================================================================

/**
 * Ask a question against the RAG document store, abort-safe via AbortSignal.
 * Yields SSE events parsed by the shared parser.
 */
export async function* askQuestion(
  question: string,
  docType?: string,
  topK = 5,
  signal?: AbortSignal,
): AsyncGenerator<SSEEvent> {
  const response = await fetch(`${API_BASE}/qa/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({ question, docType, topK }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `QA error: ${response.statusText}`);
  }
  if (!response.body) throw new Error('No response body');

  for await (const evt of parseSSE(response.body, signal)) {
    yield evt;
    if (evt.event === 'done') return;
  }
}
