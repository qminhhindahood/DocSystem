import {
  getDocumentTypeName,
  getSupportedDocumentTypes,
  getTemplate,
  getTemplateContent,
  validateDecreeCompliance,
} from "./template_service";
import { DOCUMENT_TYPE_IDS } from '../constants/document-types';
import { DOCUMENT_TYPE_DEFINITIONS } from '../constants/document-types';

describe("template service document type identifiers", () => {
  it("uses normalized document type identifiers and rejects legacy aliases", () => {
    expect(getSupportedDocumentTypes()).toEqual(DOCUMENT_TYPE_IDS);
    expect(getSupportedDocumentTypes()).toHaveLength(30);

    expect(getDocumentTypeName("cong-van")).toBe("Công văn");
    expect(getDocumentTypeName("thong-bao")).toBe("Thông báo");
    expect(getDocumentTypeName("thong-tu")).toBe("Thông tư");
    expect(getTemplate("cong-van").name).toBe("Công văn");
    expect(getTemplate("thong-tu").name).toBe("Thông tư");
    expect(getTemplateContent("thong-bao")).toContain("THÔNG BÁO");
    expect(getTemplateContent("thong-tu")).toContain("THÔNG TƯ");

    expect(() => getTemplate("cong-hoa")).toThrow("Invalid document type");
    expect(() => getTemplateContent("ban-ao")).toThrow("Invalid document type");
  });

  it('provides a complete semantic and canonical text contract for every type', () => {
    for (const type of DOCUMENT_TYPE_IDS) {
      const template = getTemplate(type);
      const fieldNames = template.fields.map(field => field.name);
      expect(template.name).toBe(getDocumentTypeName(type));
      expect(fieldNames).toEqual(expect.arrayContaining([
        'agency_name', 'document_number', 'place', 'date_vn', 'subject',
        'distribution_list', 'appendices', 'security_level', 'urgency_level',
        'drafter_code', 'copy_count', 'agency_address', 'agency_email',
        'agency_website', 'agency_phone',
      ]));
      expect(getTemplateContent(type)).toContain('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM');
      expect(getTemplateContent(type)).toContain('[VÙNG KÝ SỐ');
      if (DOCUMENT_TYPE_DEFINITIONS[type].attachmentCapable) {
        expect(fieldNames).toEqual(expect.arrayContaining([
          'issuance_mode', 'parent_document_number', 'parent_document_date', 'attachment_title',
        ]));
      }
    }
  });

  it("validates normalized document type names against generated content", () => {
    const result = validateDecreeCompliance(
      [
        "CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM",
        "Độc lập - Tự do - Hạnh phúc",
        "CÔNG VĂN",
        "Nơi nhận",
        "Ký, ghi rõ họ tên",
      ].join("\n"),
      "cong-van",
    );

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual([]);
  });
});
