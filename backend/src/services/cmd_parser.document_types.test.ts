import { DOCUMENT_TYPE_IDS, DOCUMENT_TYPE_DEFINITIONS } from '../constants/document-types';
import { parseCommand } from './cmd_parser';

describe('command parser document type registry', () => {
  it.each(DOCUMENT_TYPE_IDS)('detects %s from its Vietnamese display name', (id) => {
    const result = parseCommand(`Soạn ${DOCUMENT_TYPE_DEFINITIONS[id].name} về công tác giáo dục`);
    expect(result.docType).toBe(id);
  });

  it('detects normalized aliases without Vietnamese accents', () => {
    expect(parseCommand('Tao ban ghi nho MOU').docType).toBe('ban-ghi-nho');
    expect(parseCommand('Viet giay uy quyen').docType).toBe('giay-uy-quyen');
  });
});
