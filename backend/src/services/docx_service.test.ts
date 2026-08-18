import { generateDocumentDocx, VIETNAMESE_GOV_FORMAT } from './docx_service';
import { DOCUMENT_TYPE_IDS, DOCUMENT_TYPE_DEFINITIONS } from '../constants/document-types';
import * as fs from 'fs';
import * as path from 'path';

describe('docx_service', () => {
  const outDir = path.join(__dirname, '../../test/output');

  beforeAll(() => {
    fs.mkdirSync(outDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('exports a simple quyet-dinh document as valid docx buffer', async () => {
    const buffer = await generateDocumentDocx({
      content: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc\n\nSố: 01/QĐ\n\nQUYẾT ĐỊNH\n\nV/v Test decision\n\nĐiều 1. Nội dung chính\n\nTM. CƠ QUAN\nCHỨC VỤ',
      docType: 'quyet-dinh',
    });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(500);
    const header = buffer.subarray(0, 4).toString('hex');
    expect(header).toBe('504b0304');
  });

  it('exports a bao-cao document with correct docType', async () => {
    const buffer = await generateDocumentDocx({
      content: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nBÁO CÁO\n\nKính gửi: Cơ quan',
      docType: 'bao-cao',
    });
    expect(buffer.length).toBeGreaterThan(500);
  });

  it('throws on unsupported docType', async () => {
    await expect(
      generateDocumentDocx({
        content: 'test',
        docType: 'invalid-type',
      })
    ).rejects.toThrow();
  });

  it('exports with metadata (author, title)', async () => {
    const buffer = await generateDocumentDocx({
      content: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nCÔNG VĂN\n\nNội dung',
      docType: 'cong-van',
      title: 'Test Document',
    });
    expect(buffer.subarray(0, 4).toString('hex')).toBe('504b0304');
  });

  it.each(DOCUMENT_TYPE_IDS)('exports the canonical %s document type', async (docType) => {
    const definition = DOCUMENT_TYPE_DEFINITIONS[docType];
    const content = [
      'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
      'Độc lập - Tự do - Hạnh phúc',
      definition.hasTypeHeading ? definition.title : 'V/v nội dung công việc',
      'Nội dung văn bản',
      'Nơi nhận:',
      '[VÙNG KÝ SỐ VÀ ĐÓNG DẤU]',
    ].join('\n');
    const buffer = await generateDocumentDocx({ content, docType });
    expect(buffer.subarray(0, 4).toString('hex')).toBe('504b0304');
  });
});
