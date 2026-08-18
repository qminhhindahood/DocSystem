/**
 * Canonical registry for Vietnamese administrative document types.
 *
 * The 29 administrative types follow Decree 30/2020/ND-CP. Thong tu is
 * retained because the application already supports ministry-issued legal
 * instruments. Keep all type-specific behavior rooted in this registry.
 */

export const DOCUMENT_TYPE_IDS = [
  'nghi-quyet',
  'quyet-dinh',
  'chi-thi',
  'quy-che',
  'quy-dinh',
  'thong-tu',
  'thong-cao',
  'thong-bao',
  'huong-dan',
  'chuong-trinh',
  'ke-hoach',
  'phuong-an',
  'de-an',
  'du-an',
  'bao-cao',
  'bien-ban',
  'to-trinh',
  'hop-dong',
  'cong-van',
  'cong-dien',
  'ban-ghi-nho',
  'ban-thoa-thuan',
  'giay-uy-quyen',
  'giay-moi',
  'giay-gioi-thieu',
  'giay-nghi-phep',
  'phieu-gui',
  'phieu-chuyen',
  'phieu-bao',
  'thu-cong',
] as const;

export type DocumentTypeId = (typeof DOCUMENT_TYPE_IDS)[number];

export type DocumentFamily =
  | 'decision-regulatory'
  | 'planning-proposal'
  | 'reporting-record'
  | 'communication'
  | 'multi-party'
  | 'administrative-form'
  | 'routing-form';

export interface DocumentTypeDefinition {
  id: DocumentTypeId;
  name: string;
  title: string;
  family: DocumentFamily;
  codePrefix: string;
  hasTypeHeading: boolean;
  requiresLegalBasis: boolean;
  signatureMode: 'single' | 'multiple';
  attachmentCapable: boolean;
  sections: readonly string[];
  aliases: readonly string[];
}

const definition = (
  id: DocumentTypeId,
  name: string,
  family: DocumentFamily,
  codePrefix: string,
  sections: readonly string[],
  options: Partial<Pick<DocumentTypeDefinition,
    'hasTypeHeading' | 'requiresLegalBasis' | 'signatureMode' | 'attachmentCapable'>> = {},
  aliases: readonly string[] = [],
): DocumentTypeDefinition => ({
  id,
  name,
  title: name.toLocaleUpperCase('vi-VN'),
  family,
  codePrefix,
  hasTypeHeading: options.hasTypeHeading ?? true,
  requiresLegalBasis: options.requiresLegalBasis ?? false,
  signatureMode: options.signatureMode ?? 'single',
  attachmentCapable: options.attachmentCapable ?? false,
  sections,
  aliases: [name, ...aliases],
});

export const DOCUMENT_TYPE_DEFINITIONS: Record<DocumentTypeId, DocumentTypeDefinition> = {
  'nghi-quyet': definition('nghi-quyet', 'Nghị quyết', 'decision-regulatory', 'NQ',
    ['legal_basis', 'resolution_items', 'effect', 'implementation'],
    { requiresLegalBasis: true, attachmentCapable: true }, ['nghị quyết cá biệt']),
  'quyet-dinh': definition('quyet-dinh', 'Quyết định', 'decision-regulatory', 'QĐ',
    ['legal_basis', 'decision_items', 'effect', 'implementation'],
    { requiresLegalBasis: true, attachmentCapable: true }),
  'chi-thi': definition('chi-thi', 'Chỉ thị', 'decision-regulatory', 'CT',
    ['legal_basis', 'objectives', 'directives', 'implementation'],
    { requiresLegalBasis: true }),
  'quy-che': definition('quy-che', 'Quy chế', 'decision-regulatory', 'QC',
    ['scope', 'principles', 'chapters', 'implementation'],
    { requiresLegalBasis: true, attachmentCapable: true }),
  'quy-dinh': definition('quy-dinh', 'Quy định', 'decision-regulatory', 'QYĐ',
    ['scope', 'subjects', 'rules', 'implementation'],
    { requiresLegalBasis: true, attachmentCapable: true }),
  'thong-tu': definition('thong-tu', 'Thông tư', 'decision-regulatory', 'TT',
    ['legal_basis', 'scope', 'subjects', 'chapters', 'effect'],
    { requiresLegalBasis: true, attachmentCapable: true }),
  'thong-cao': definition('thong-cao', 'Thông cáo', 'communication', 'TC',
    ['context', 'announcement', 'contact']),
  'thong-bao': definition('thong-bao', 'Thông báo', 'communication', 'TB',
    ['context', 'announcement', 'requirements', 'contact']),
  'huong-dan': definition('huong-dan', 'Hướng dẫn', 'communication', 'HD',
    ['legal_basis', 'scope', 'guidance_items', 'implementation'],
    { requiresLegalBasis: true }),
  'chuong-trinh': definition('chuong-trinh', 'Chương trình', 'planning-proposal', 'CTr',
    ['basis', 'objectives', 'activities', 'schedule', 'implementation'],
    { attachmentCapable: true }),
  'ke-hoach': definition('ke-hoach', 'Kế hoạch', 'planning-proposal', 'KH',
    ['basis', 'objectives', 'requirements', 'tasks', 'schedule', 'budget', 'implementation'],
    { attachmentCapable: true }),
  'phuong-an': definition('phuong-an', 'Phương án', 'planning-proposal', 'PA',
    ['basis', 'situation', 'objectives', 'options', 'selected_option', 'implementation'],
    { attachmentCapable: true }),
  'de-an': definition('de-an', 'Đề án', 'planning-proposal', 'ĐA',
    ['basis', 'necessity', 'objectives', 'scope', 'solutions', 'resources', 'roadmap'],
    { attachmentCapable: true }),
  'du-an': definition('du-an', 'Dự án', 'planning-proposal', 'DA',
    ['basis', 'project_summary', 'objectives', 'deliverables', 'resources', 'schedule', 'risks'],
    { attachmentCapable: true }),
  'bao-cao': definition('bao-cao', 'Báo cáo', 'reporting-record', 'BC',
    ['basis', 'situation', 'results', 'assessment', 'limitations', 'recommendations']),
  'bien-ban': definition('bien-ban', 'Biên bản', 'reporting-record', 'BB',
    ['time_location', 'participants', 'agenda', 'proceedings', 'conclusions'],
    { signatureMode: 'multiple' }),
  'to-trinh': definition('to-trinh', 'Tờ trình', 'planning-proposal', 'TTr',
    ['recipient', 'legal_basis', 'necessity', 'proposal', 'requested_decision'],
    { requiresLegalBasis: true }),
  'hop-dong': definition('hop-dong', 'Hợp đồng', 'multi-party', 'HĐ',
    ['legal_basis', 'parties', 'subject', 'rights_obligations', 'value_payment', 'term', 'disputes'],
    { requiresLegalBasis: true, signatureMode: 'multiple', attachmentCapable: true }),
  'cong-van': definition('cong-van', 'Công văn', 'communication', 'CV',
    ['recipient', 'context', 'content', 'request', 'contact'],
    { hasTypeHeading: false }),
  'cong-dien': definition('cong-dien', 'Công điện', 'communication', 'CĐ',
    ['recipients', 'urgent_context', 'orders', 'reporting_requirements']),
  'ban-ghi-nho': definition('ban-ghi-nho', 'Bản ghi nhớ', 'multi-party', 'BGN',
    ['parties', 'purpose', 'cooperation_areas', 'responsibilities', 'term', 'amendment'],
    { signatureMode: 'multiple', attachmentCapable: true }, ['MOU', 'biên bản ghi nhớ']),
  'ban-thoa-thuan': definition('ban-thoa-thuan', 'Bản thỏa thuận', 'multi-party', 'BTT',
    ['parties', 'purpose', 'terms', 'responsibilities', 'term', 'disputes'],
    { signatureMode: 'multiple', attachmentCapable: true }, ['thỏa thuận hợp tác']),
  'giay-uy-quyen': definition('giay-uy-quyen', 'Giấy ủy quyền', 'administrative-form', 'GUQ',
    ['authorizer', 'authorized_person', 'authorization_scope', 'term', 'commitment'],
    { requiresLegalBasis: true, signatureMode: 'multiple' }),
  'giay-moi': definition('giay-moi', 'Giấy mời', 'administrative-form', 'GM',
    ['invitees', 'purpose', 'time', 'location', 'preparation', 'contact']),
  'giay-gioi-thieu': definition('giay-gioi-thieu', 'Giấy giới thiệu', 'administrative-form', 'GGT',
    ['introduced_person', 'organization', 'purpose', 'destination', 'validity']),
  'giay-nghi-phep': definition('giay-nghi-phep', 'Giấy nghỉ phép', 'administrative-form', 'GNP',
    ['employee', 'position_unit', 'leave_period', 'reason', 'handover', 'approval']),
  'phieu-gui': definition('phieu-gui', 'Phiếu gửi', 'routing-form', 'PG',
    ['recipient', 'enclosures', 'purpose', 'instructions']),
  'phieu-chuyen': definition('phieu-chuyen', 'Phiếu chuyển', 'routing-form', 'PC',
    ['source', 'destination', 'received_item', 'reason', 'handling_request', 'deadline']),
  'phieu-bao': definition('phieu-bao', 'Phiếu báo', 'routing-form', 'PB',
    ['recipient', 'notice', 'action_required', 'deadline', 'contact']),
  'thu-cong': definition('thu-cong', 'Thư công', 'communication', 'TCg',
    ['addressee', 'salutation', 'message', 'closing']),
};

export const DOCUMENT_TYPE_NAMES = Object.fromEntries(
  DOCUMENT_TYPE_IDS.map(id => [id, DOCUMENT_TYPE_DEFINITIONS[id].name]),
) as Record<DocumentTypeId, string>;

export function isDocumentTypeId(value: string): value is DocumentTypeId {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TYPE_DEFINITIONS, value);
}

export function getDocumentTypeDefinition(value: string): DocumentTypeDefinition | undefined {
  return isDocumentTypeId(value) ? DOCUMENT_TYPE_DEFINITIONS[value] : undefined;
}
