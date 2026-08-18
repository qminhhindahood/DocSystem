import { autoDetectMappings, compileGenerationSchema, type SemanticMap } from './template_semantics';
import type { StructuralAnalysis } from '../types/templates';

jest.mock('./template_service', () => ({
  buildDocumentFieldJsonSchema: jest.fn((field) => field.type === 'date'
    ? { type: 'string', pattern: '^\\d{2}/\\d{2}/\\d{4}$' }
    : { type: 'string' }),
  getTemplateFields: jest.fn().mockReturnValue([
    { name: 'agency_name', label: 'Tên cơ quan', type: 'text', required: true },
    { name: 'document_number', label: 'Số hiệu', type: 'text', required: true },
    { name: 'place', label: 'Địa điểm', type: 'text', required: true, defaultValue: 'Hà Nội' },
    { name: 'date_vn', label: 'Ngày tháng', type: 'date', required: true },
    { name: 'subject', label: 'Trích yếu', type: 'textarea', required: true },
    { name: 'signatory_name', label: 'Người ký', type: 'text', required: true },
    { name: 'signatory_title', label: 'Chức vụ', type: 'text', required: true },
  ]),
}));

const SAMPLE_ANALYSIS: StructuralAnalysis = {
  documentFingerprint: 'fp-test-001',
  candidates: [
    { locator: 'main/p[1]', kind: 'BODY_PARAGRAPH', textSnippet: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', fingerprint: null },
    { locator: 'main/p[2]', kind: 'BODY_PARAGRAPH', textSnippet: 'Độc lập - Tự do - Hạnh phúc', fingerprint: null },
    { locator: 'main/p[3]', kind: 'BODY_PARAGRAPH', textSnippet: 'Số: .../QĐ-BGDĐT', fingerprint: null },
    { locator: 'main/p[4]', kind: 'BODY_PARAGRAPH', textSnippet: 'BỘ GIÁO DỤC VÀ ĐÀO TẠO', fingerprint: null },
    { locator: 'main/p[5]', kind: 'BODY_PARAGRAPH', textSnippet: 'Hà Nội, ngày ... tháng ... năm ...', fingerprint: null },
    { locator: 'main/p[6]', kind: 'BODY_PARAGRAPH', textSnippet: 'QUYẾT ĐỊNH', fingerprint: null },
    { locator: 'main/p[7]', kind: 'BODY_PARAGRAPH', textSnippet: 'V/v ban hành quy chế đào tạo', fingerprint: null },
    { locator: 'main/p[8]', kind: 'BODY_PARAGRAPH', textSnippet: 'Căn cứ Luật Giáo dục đại học 2012', fingerprint: null },
    { locator: 'main/p[20]', kind: 'BODY_PARAGRAPH', textSnippet: 'Nơi nhận:', fingerprint: null },
    { locator: 'main/p[22]', kind: 'BODY_PARAGRAPH', textSnippet: 'KT. BỘ TRƯỞNG', fingerprint: null },
    { locator: 'main/p[23]', kind: 'BODY_PARAGRAPH', textSnippet: 'KÝ, GHI RÕ HỌ VÀ TÊN', fingerprint: null },
  ],
  compatibility: ['mc:AlternateContent found at main/p[9]'],
};

describe('template_semantics', () => {
  describe('autoDetectMappings', () => {
    it('detects agency_name from BỘ pattern', () => {
      const mappings = autoDetectMappings('quyet-dinh', SAMPLE_ANALYSIS);
      const agency = mappings.find(m => m.fieldName === 'agency_name');
      expect(agency).toBeDefined();
      expect(agency!.locator).toBe('main/p[4]');
      expect(agency!.confidence).toBeGreaterThan(0);
    });

    it('detects document_number from Số: pattern', () => {
      const mappings = autoDetectMappings('quyet-dinh', SAMPLE_ANALYSIS);
      const docNum = mappings.find(m => m.fieldName === 'document_number');
      expect(docNum).toBeDefined();
      expect(docNum!.locator).toBe('main/p[3]');
    });

    it('detects signatory_name from KÝ pattern', () => {
      const mappings = autoDetectMappings('quyet-dinh', SAMPLE_ANALYSIS);
      const sig = mappings.find(m => m.fieldName === 'signatory_name');
      expect(sig).toBeDefined();
      expect(sig!.locator).toBe('main/p[23]');
    });

    it('detects signatory_title from BỘ TRƯỞNG / TM. pattern', () => {
      const mappings = autoDetectMappings('quyet-dinh', SAMPLE_ANALYSIS);
      const title = mappings.find(m => m.fieldName === 'signatory_title');
      expect(title).toBeDefined();
      expect(title!.locator).toMatch(/main\/p\[(22|4)\]/);
    });

    it('returns null locator for fields with no match', () => {
      const empty: StructuralAnalysis = {
        documentFingerprint: 'fp-empty',
        candidates: [{ locator: 'main/p[1]', kind: 'BODY_PARAGRAPH', textSnippet: 'irrelevant text', fingerprint: null }],
        compatibility: [],
      };
      const mappings = autoDetectMappings('quyet-dinh', empty);
      const allNull = mappings.every(m => m.locator === null);
      expect(allNull).toBe(true);
    });
  });

  describe('compileGenerationSchema', () => {
    const semanticMap: SemanticMap = {
      version: 1,
      documentFingerprint: 'fp-test-001',
      mappings: [
        { fieldName: 'agency_name', locator: 'main/p[4]', kind: 'BODY_PARAGRAPH', confidence: 0.8 },
        { fieldName: 'place', locator: 'main/p[5]', kind: 'BODY_PARAGRAPH', confidence: 0.6 },
        { fieldName: 'signatory_name', locator: null, kind: 'UNKNOWN', confidence: 0 },
      ],
      ignoredLocators: [],
    };

    it('compiles field entries with resolved locator info', () => {
      const schema = compileGenerationSchema(semanticMap, SAMPLE_ANALYSIS, 'quyet-dinh');

      const agency = schema.fields.find(f => f.name === 'agency_name');
      expect(agency).toBeDefined();
      expect(agency!.locator).toBe('main/p[4]');
      expect(agency!.textSnippet).toContain('BỘ GIÁO DỤC');

      const sig = schema.fields.find(f => f.name === 'signatory_name');
      expect(sig).toBeDefined();
      expect(sig!.locator).toBeNull();
      expect(sig!.textSnippet).toBe('');
    });

    it('carries default value from template definition', () => {
      const schema = compileGenerationSchema(semanticMap, SAMPLE_ANALYSIS, 'quyet-dinh');
      const place = schema.fields.find(f => f.name === 'place');
      expect(place).toBeDefined();
      expect(place!.defaultValue).toBe('Hà Nội');
    });

    it('lists unmapped candidates not in the map', () => {
      const schema = compileGenerationSchema(semanticMap, SAMPLE_ANALYSIS, 'quyet-dinh');
      // main/p[4] is mapped, all others (excluding ignored) are unmapped
      expect(schema.unmappedCandidates.length).toBeGreaterThan(0);
      expect(schema.unmappedCandidates.find(c => c.locator === 'main/p[4]')).toBeUndefined();
    });

    it('reports AlternateContent in metadata', () => {
      const schema = compileGenerationSchema(semanticMap, SAMPLE_ANALYSIS, 'quyet-dinh');
      expect(schema.metadata.hasAlternateContent).toBe(true);
      expect(schema.metadata.compatibility).toContain('mc:AlternateContent found at main/p[9]');
    });
  });
});
