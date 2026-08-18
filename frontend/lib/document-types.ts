export const DOCUMENT_TYPES = [
  { id: 'nghi-quyet', name: 'Nghị quyết' },
  { id: 'quyet-dinh', name: 'Quyết định' },
  { id: 'chi-thi', name: 'Chỉ thị' },
  { id: 'quy-che', name: 'Quy chế' },
  { id: 'quy-dinh', name: 'Quy định' },
  { id: 'thong-tu', name: 'Thông tư' },
  { id: 'thong-cao', name: 'Thông cáo' },
  { id: 'thong-bao', name: 'Thông báo' },
  { id: 'huong-dan', name: 'Hướng dẫn' },
  { id: 'chuong-trinh', name: 'Chương trình' },
  { id: 'ke-hoach', name: 'Kế hoạch' },
  { id: 'phuong-an', name: 'Phương án' },
  { id: 'de-an', name: 'Đề án' },
  { id: 'du-an', name: 'Dự án' },
  { id: 'bao-cao', name: 'Báo cáo' },
  { id: 'bien-ban', name: 'Biên bản' },
  { id: 'to-trinh', name: 'Tờ trình' },
  { id: 'hop-dong', name: 'Hợp đồng' },
  { id: 'cong-van', name: 'Công văn' },
  { id: 'cong-dien', name: 'Công điện' },
  { id: 'ban-ghi-nho', name: 'Bản ghi nhớ' },
  { id: 'ban-thoa-thuan', name: 'Bản thỏa thuận' },
  { id: 'giay-uy-quyen', name: 'Giấy ủy quyền' },
  { id: 'giay-moi', name: 'Giấy mời' },
  { id: 'giay-gioi-thieu', name: 'Giấy giới thiệu' },
  { id: 'giay-nghi-phep', name: 'Giấy nghỉ phép' },
  { id: 'phieu-gui', name: 'Phiếu gửi' },
  { id: 'phieu-chuyen', name: 'Phiếu chuyển' },
  { id: 'phieu-bao', name: 'Phiếu báo' },
  { id: 'thu-cong', name: 'Thư công' },
] as const;

export type DocumentTypeId = (typeof DOCUMENT_TYPES)[number]['id'];

export const DOCUMENT_TYPE_LABELS: Record<DocumentTypeId, string> = Object.fromEntries(
  DOCUMENT_TYPES.map(type => [type.id, type.name]),
) as Record<DocumentTypeId, string>;

export const DOCUMENT_TYPE_OPTIONS = DOCUMENT_TYPES.map(type => ({
  value: type.id,
  label: type.name,
}));

export function formatDocumentType(type: string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentTypeId] ?? type;
}
