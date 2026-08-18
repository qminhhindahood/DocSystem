/**
 * Decree 30 document schema and canonical text service.
 *
 * PDF/DOCX templates control visual fidelity. This service defines the
 * semantic contract shared by generation, validation, mapping, and forms.
 */

import {
  DOCUMENT_TYPE_DEFINITIONS,
  DOCUMENT_TYPE_IDS,
  DOCUMENT_TYPE_NAMES,
  getDocumentTypeDefinition,
  type DocumentTypeDefinition,
  type DocumentTypeId,
} from '../constants/document-types';

export type DocumentFieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'select'
  | 'list'
  | 'number'
  | 'boolean'
  | 'object-list'
  | 'table';

export interface DocumentField {
  name: string;
  label: string;
  type: DocumentFieldType;
  required: boolean;
  description?: string;
  defaultValue?: string;
  options?: string[];
  itemProperties?: Record<string, { type: 'string' | 'number' | 'boolean'; label: string; required?: boolean }>;
}

export interface TemplateStructure {
  name: string;
  article: string;
  header: string;
  sections: string[];
  fields: DocumentField[];
}

export interface TemplateValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

export function buildDocumentFieldJsonSchema(fieldDefinition: DocumentField): Record<string, unknown> {
  const description = fieldDefinition.description ?? fieldDefinition.label;
  if (fieldDefinition.type === 'date') {
    return { type: 'string', pattern: '^\\d{2}/\\d{2}/\\d{4}$', description };
  }
  if (fieldDefinition.type === 'select') {
    return {
      type: 'string',
      ...(fieldDefinition.options?.length ? { enum: fieldDefinition.options } : {}),
      description,
    };
  }
  if (fieldDefinition.type === 'list') {
    return { type: 'array', items: { type: 'string' }, description };
  }
  if (fieldDefinition.type === 'object-list' || fieldDefinition.type === 'table') {
    const entries = Object.entries(fieldDefinition.itemProperties ?? {});
    return {
      type: 'array',
      items: {
        type: 'object',
        properties: Object.fromEntries(entries.map(([name, item]) => [name, {
          type: item.type,
          description: item.label,
        }])),
        required: entries.filter(([, item]) => item.required).map(([name]) => name),
        additionalProperties: false,
      },
      description,
    };
  }
  if (fieldDefinition.type === 'number') return { type: 'number', description };
  if (fieldDefinition.type === 'boolean') return { type: 'boolean', description };
  if (fieldDefinition.type === 'textarea') return { type: 'string', maxLength: 20_000, description };
  return { type: 'string', description };
}

const HEADER = 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc';

const SECTION_LABELS: Record<string, string> = {
  legal_basis: 'Căn cứ pháp lý', resolution_items: 'Nội dung nghị quyết', effect: 'Hiệu lực',
  implementation: 'Tổ chức thực hiện', decision_items: 'Các điều quyết định', objectives: 'Mục tiêu',
  directives: 'Nội dung chỉ thị', scope: 'Phạm vi', principles: 'Nguyên tắc', chapters: 'Chương, mục, điều',
  subjects: 'Đối tượng áp dụng', rules: 'Quy định cụ thể', context: 'Bối cảnh', announcement: 'Nội dung thông báo',
  contact: 'Thông tin liên hệ', requirements: 'Yêu cầu', guidance_items: 'Nội dung hướng dẫn', basis: 'Cơ sở xây dựng',
  activities: 'Hoạt động', schedule: 'Tiến độ', tasks: 'Nhiệm vụ, giải pháp', budget: 'Kinh phí',
  situation: 'Tình hình thực tế', options: 'Các phương án', selected_option: 'Phương án lựa chọn',
  necessity: 'Sự cần thiết', solutions: 'Nhiệm vụ, giải pháp', resources: 'Nguồn lực', roadmap: 'Lộ trình',
  project_summary: 'Thông tin dự án', deliverables: 'Sản phẩm, kết quả', risks: 'Rủi ro và biện pháp',
  results: 'Kết quả', assessment: 'Đánh giá', limitations: 'Tồn tại, hạn chế', recommendations: 'Kiến nghị',
  time_location: 'Thời gian, địa điểm', participants: 'Thành phần tham dự', agenda: 'Nội dung làm việc',
  proceedings: 'Diễn biến', conclusions: 'Kết luận', recipient: 'Kính gửi', proposal: 'Nội dung trình',
  requested_decision: 'Kiến nghị cấp có thẩm quyền', parties: 'Các bên', subject: 'Đối tượng và phạm vi',
  rights_obligations: 'Quyền và nghĩa vụ', value_payment: 'Giá trị và thanh toán', term: 'Thời hạn',
  disputes: 'Giải quyết tranh chấp', content: 'Nội dung', request: 'Đề nghị, yêu cầu', recipients: 'Nơi nhận công điện',
  urgent_context: 'Tình huống khẩn cấp', orders: 'Mệnh lệnh, nhiệm vụ', reporting_requirements: 'Chế độ báo cáo',
  purpose: 'Mục đích', cooperation_areas: 'Lĩnh vực hợp tác', responsibilities: 'Trách nhiệm các bên',
  amendment: 'Sửa đổi, bổ sung', terms: 'Điều khoản thỏa thuận', authorizer: 'Bên ủy quyền',
  authorized_person: 'Bên được ủy quyền', authorization_scope: 'Phạm vi ủy quyền', commitment: 'Cam kết',
  invitees: 'Người được mời', time: 'Thời gian', location: 'Địa điểm', preparation: 'Nội dung chuẩn bị',
  introduced_person: 'Người được giới thiệu', organization: 'Cơ quan/đơn vị', destination: 'Nơi đến làm việc',
  validity: 'Thời hạn sử dụng', employee: 'Người xin nghỉ', position_unit: 'Chức vụ, đơn vị',
  leave_period: 'Thời gian nghỉ', reason: 'Lý do', handover: 'Bàn giao công việc', approval: 'Ý kiến phê duyệt',
  enclosures: 'Tài liệu gửi kèm', instructions: 'Chỉ dẫn xử lý', source: 'Nơi chuyển',
  received_item: 'Văn bản/hồ sơ được chuyển', handling_request: 'Yêu cầu xử lý', deadline: 'Thời hạn',
  notice: 'Nội dung báo', action_required: 'Nội dung cần thực hiện', addressee: 'Người nhận thư',
  salutation: 'Lời chào', message: 'Nội dung thư', closing: 'Lời kết',
};

const TABLE_SECTIONS = new Set(['schedule', 'budget', 'resources', 'roadmap', 'deliverables']);
const LIST_SECTIONS = new Set([
  'legal_basis', 'resolution_items', 'decision_items', 'directives', 'rules', 'announcement', 'requirements',
  'guidance_items', 'activities', 'tasks', 'options', 'solutions', 'results', 'limitations', 'recommendations',
  'agenda', 'orders', 'reporting_requirements', 'cooperation_areas', 'responsibilities', 'terms', 'invitees',
  'enclosures', 'instructions', 'action_required',
]);
const OBJECT_LIST_SECTIONS = new Set(['parties', 'participants']);

const field = (
  name: string,
  label: string,
  type: DocumentFieldType,
  required = false,
  extra: Partial<DocumentField> = {},
): DocumentField => ({ name, label, type, required, ...extra });

const partyProperties: NonNullable<DocumentField['itemProperties']> = {
  name: { type: 'string', label: 'Tên cơ quan/cá nhân', required: true },
  representative: { type: 'string', label: 'Người đại diện' },
  title: { type: 'string', label: 'Chức vụ' },
  address: { type: 'string', label: 'Địa chỉ' },
  identifier: { type: 'string', label: 'Mã định danh/mã số thuế' },
};

const signatoryProperties: NonNullable<DocumentField['itemProperties']> = {
  party: { type: 'string', label: 'Bên/cơ quan', required: true },
  title: { type: 'string', label: 'Chức vụ', required: true },
  name: { type: 'string', label: 'Họ tên', required: true },
  signingAuthority: { type: 'string', label: 'Thẩm quyền ký' },
};

function identityFields(def: DocumentTypeDefinition): DocumentField[] {
  return [
    field('supervising_agency', 'Cơ quan chủ quản', 'text'),
    field('agency_name', 'Tên cơ quan, tổ chức ban hành', 'text', true),
    field('document_number', 'Số, ký hiệu văn bản', 'text', true,
      { description: `Ví dụ: 123/${def.codePrefix}-BGDĐT` }),
    field('place', 'Địa danh ban hành', 'text', true, { defaultValue: 'Hà Nội' }),
    field('date_vn', 'Ngày ban hành', 'date', true),
    field('subject', 'Trích yếu nội dung', 'textarea', true),
  ];
}

function optionalComponentFields(): DocumentField[] {
  return [
    field('appendices', 'Phụ lục', 'object-list', false, {
      itemProperties: {
        title: { type: 'string', label: 'Tên phụ lục', required: true },
        reference: { type: 'string', label: 'Ký hiệu/tham chiếu' },
        content: { type: 'string', label: 'Nội dung' },
      },
    }),
    field('security_level', 'Độ mật', 'select', false,
      { options: ['Không', 'Mật', 'Tối mật', 'Tuyệt mật'], defaultValue: 'Không' }),
    field('urgency_level', 'Mức độ khẩn', 'select', false,
      { options: ['Không', 'Khẩn', 'Thượng khẩn', 'Hỏa tốc', 'Hỏa tốc hẹn giờ'], defaultValue: 'Không' }),
    field('circulation_instructions', 'Chỉ dẫn phạm vi lưu hành', 'text'),
    field('drafter_code', 'Ký hiệu người soạn thảo', 'text'),
    field('copy_count', 'Số lượng bản phát hành', 'number'),
    field('agency_address', 'Địa chỉ cơ quan', 'text'),
    field('agency_email', 'Thư điện tử', 'text'),
    field('agency_website', 'Trang thông tin điện tử', 'text'),
    field('agency_phone', 'Số điện thoại', 'text'),
  ];
}

function attachmentFields(def: DocumentTypeDefinition): DocumentField[] {
  if (!def.attachmentCapable) return [];
  return [
    field('issuance_mode', 'Hình thức ban hành', 'select', true, {
      options: ['Văn bản độc lập', 'Ban hành kèm theo văn bản cha'],
      defaultValue: 'Văn bản độc lập',
    }),
    field('parent_document_number', 'Số, ký hiệu văn bản ban hành kèm theo', 'text'),
    field('parent_document_date', 'Ngày văn bản ban hành kèm theo', 'date'),
    field('attachment_title', 'Tên tài liệu ban hành kèm theo', 'text'),
    field('attachment_sequence', 'Thứ tự tài liệu kèm theo', 'number'),
  ];
}

function sectionField(section: string): DocumentField {
  const label = SECTION_LABELS[section] ?? section;
  if (OBJECT_LIST_SECTIONS.has(section)) {
    return field(section, label, 'object-list', true, { itemProperties: partyProperties });
  }
  if (TABLE_SECTIONS.has(section)) {
    return field(section, label, 'table', false, {
      itemProperties: {
        item: { type: 'string', label: 'Nội dung', required: true },
        owner: { type: 'string', label: 'Đơn vị chủ trì' },
        deadline: { type: 'string', label: 'Thời hạn' },
        resources: { type: 'string', label: 'Nguồn lực/kinh phí' },
      },
    });
  }
  if (LIST_SECTIONS.has(section)) return field(section, label, 'list', section === 'legal_basis');
  return field(section, label, 'textarea', ['content', 'message', 'proposal', 'proceedings'].includes(section));
}

function signatureFields(def: DocumentTypeDefinition): DocumentField[] {
  const shared = [field('distribution_list', 'Nơi nhận', 'list')];
  if (def.signatureMode === 'multiple') {
    return [
      ...shared,
      field('signatories', 'Các bên/người ký', 'object-list', true, { itemProperties: signatoryProperties }),
      field('witnesses', 'Người làm chứng/xác nhận', 'object-list', false, { itemProperties: signatoryProperties }),
    ];
  }
  return [
    ...shared,
    field('signatory_authority', 'Thẩm quyền ký', 'select', false,
      { options: ['Ký trực tiếp', 'KT.', 'TL.', 'TUQ.', 'Q.'], defaultValue: 'Ký trực tiếp' }),
    field('signatory_title', 'Chức vụ người ký', 'text', true),
    field('signatory_name', 'Họ tên người ký', 'text', true),
    field('signing_note', 'Vùng ký số và đóng dấu', 'text', false,
      { defaultValue: '[KÝ SỐ VÀ ĐÓNG DẤU TRONG HỆ THỐNG ĐƯỢC PHÊ DUYỆT]' }),
  ];
}

function buildFields(def: DocumentTypeDefinition): DocumentField[] {
  const sectionFields = def.sections
    .filter(section => !['subject'].includes(section))
    .map(sectionField);
  return [
    ...identityFields(def),
    ...attachmentFields(def),
    ...sectionFields,
    ...signatureFields(def),
    ...optionalComponentFields(),
  ];
}

function buildTemplate(def: DocumentTypeDefinition): TemplateStructure {
  return {
    name: def.name,
    article: 'NĐ 30/2020/NĐ-CP',
    header: HEADER,
    sections: [...def.sections],
    fields: buildFields(def),
  };
}

const TEMPLATES = Object.fromEntries(
  DOCUMENT_TYPE_IDS.map(id => [id, buildTemplate(DOCUMENT_TYPE_DEFINITIONS[id])]),
) as Record<DocumentTypeId, TemplateStructure>;

function placeholder(label: string): string {
  return `[${label.toLocaleUpperCase('vi-VN')}]`;
}

function buildTemplateText(def: DocumentTypeDefinition): string {
  const heading = def.hasTypeHeading ? `\n${def.title}\n${placeholder('Trích yếu nội dung')}\n` :
    `\nV/v ${placeholder('Trích yếu nội dung')}\n`;
  const body = def.sections.map((section, index) => {
    const label = SECTION_LABELS[section] ?? section;
    return `${index + 1}. ${label}\n${placeholder(label)}`;
  }).join('\n\n');
  const signature = def.signatureMode === 'multiple'
    ? '[ĐẠI DIỆN BÊN A]                         [ĐẠI DIỆN BÊN B]\n[CHỨC VỤ, HỌ TÊN]                       [CHỨC VỤ, HỌ TÊN]\n[VÙNG KÝ SỐ/ĐÓNG DẤU]                   [VÙNG KÝ SỐ/ĐÓNG DẤU]'
    : '[THẨM QUYỀN KÝ]\n[CHỨC VỤ]\n[VÙNG KÝ SỐ VÀ ĐÓNG DẤU]\n[HỌ VÀ TÊN]';

  return `[CƠ QUAN CHỦ QUẢN]\n[TÊN CƠ QUAN, TỔ CHỨC BAN HÀNH]\nSố: .../${def.codePrefix}-[KÝ HIỆU CƠ QUAN]` +
    `\n\n${HEADER}\n[ĐỊA DANH], ngày ... tháng ... năm ...${heading}\n${body}` +
    `\n\nNơi nhận:\n- [DANH SÁCH NƠI NHẬN];\n- Lưu: VT, [ĐƠN VỊ SOẠN THẢO].` +
    `\n\n${signature}\n\n[PHỤ LỤC NẾU CÓ]\n[ĐỘ MẬT/MỨC ĐỘ KHẨN/PHẠM VI LƯU HÀNH NẾU CÓ]` +
    `\n[KÝ HIỆU NGƯỜI SOẠN THẢO - SỐ LƯỢNG BẢN]\n[ĐỊA CHỈ | EMAIL | WEBSITE | ĐIỆN THOẠI]`;
}

export const TEMPLATE_TEXTS = Object.fromEntries(
  DOCUMENT_TYPE_IDS.map(id => [id, buildTemplateText(DOCUMENT_TYPE_DEFINITIONS[id])]),
) as Record<DocumentTypeId, string>;

function requireDefinition(documentType: string): DocumentTypeDefinition {
  const definition = getDocumentTypeDefinition(documentType);
  if (!definition) {
    throw new Error(`Invalid document type: ${documentType}. Valid types: ${DOCUMENT_TYPE_IDS.join(', ')}`);
  }
  return definition;
}

export function getTemplate(documentType: string): TemplateStructure {
  const definition = requireDefinition(documentType);
  return TEMPLATES[definition.id];
}

export function getTemplateFields(documentType: string): DocumentField[] {
  return getTemplate(documentType).fields;
}

export function getTemplateContent(documentType: string): string {
  const definition = requireDefinition(documentType);
  return TEMPLATE_TEXTS[definition.id];
}

const contains = (content: string, expected: string): boolean =>
  content.toLocaleUpperCase('vi-VN').includes(expected.toLocaleUpperCase('vi-VN'));

export function validateDecreeCompliance(content: string, documentType: string): TemplateValidationResult {
  const definition = requireDefinition(documentType);
  const result: TemplateValidationResult = { valid: true, missing: [], warnings: [] };
  for (const required of ['CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 'Độc lập - Tự do - Hạnh phúc']) {
    if (!contains(content, required)) result.missing.push(required);
  }
  if (definition.hasTypeHeading && !contains(content, definition.title)) {
    result.warnings.push(`Document should include the type name (${definition.title})`);
  }
  if (definition.requiresLegalBasis && !/(?:Căn cứ|CĂN CỨ)/u.test(content)) {
    result.warnings.push('Document should include its legal basis');
  }
  if (!/(?:Nơi nhận|NƠI NHẬN)/u.test(content)) result.warnings.push('Document should include its distribution list');
  if (!/(?:Ký|KÝ|người ký|NGƯỜI KÝ|đại diện|ĐẠI DIỆN)/u.test(content)) {
    result.warnings.push('Document should include a signing block');
  }
  result.valid = result.missing.length === 0;
  return result;
}

export function getSupportedDocumentTypes(): string[] {
  return [...DOCUMENT_TYPE_IDS];
}

export function getDocumentTypeName(documentType: string): string {
  return getDocumentTypeDefinition(documentType)?.name ?? documentType;
}

export { DOCUMENT_TYPE_NAMES };
