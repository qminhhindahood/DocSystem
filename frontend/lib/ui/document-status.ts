export type DocumentStatusPresentation = {
  label: string;
  variant: 'neutral' | 'info' | 'success' | 'warning';
};

/**
 * Localized presentation for the document statuses the backend actually writes.
 *
 * `draft` is the Prisma default, `uploaded` comes from the RAG ingestion path, and
 * `pending` / `approved` / `published` are named in the schema contract. `final` is
 * the value the documents filter exposes. Anything else renders a neutral fallback
 * rather than inventing a meaning.
 */
const PRESENTATIONS: Record<string, DocumentStatusPresentation> = {
  draft: { label: 'Bản nháp', variant: 'info' },
  final: { label: 'Hoàn chỉnh', variant: 'success' },
  uploaded: { label: 'Đã tải lên', variant: 'neutral' },
  pending: { label: 'Chờ xử lý', variant: 'warning' },
  approved: { label: 'Đã phê duyệt', variant: 'success' },
  published: { label: 'Đã ban hành', variant: 'success' },
};

const UNKNOWN: DocumentStatusPresentation = {
  label: 'Trạng thái khác',
  variant: 'neutral',
};

export function getDocumentStatusPresentation(status: string): DocumentStatusPresentation {
  return PRESENTATIONS[status?.trim().toLowerCase()] ?? UNKNOWN;
}

/**
 * Filter options limited to statuses a user can meaningfully select. No sort or
 * archive contract exists, so neither appears here.
 */
export const DOCUMENT_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'draft', label: 'Bản nháp' },
  { value: 'final', label: 'Hoàn chỉnh' },
] as const;
