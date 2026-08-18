const mockFindFirst = jest.fn();
const mockUpdateMany = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    template: {
      findFirst: (...args: unknown[]) => mockFindFirst(...args),
      updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    },
  },
}));

jest.mock('./template_service_client', () => ({
  analyzeTemplate: jest.fn(),
}));

jest.mock('./template_vision_service', () => ({
  mapTemplateWithVision: jest.fn(async (input: any) => ({
    mappings: input.structuralMappings,
    overallConfidence: 0.5,
  })),
}));

import { analyzeTemplate } from './template_service_client';
import { mapTemplateWithVision } from './template_vision_service';
import { fuseTemplate, recompileSchema } from './template_compiler';
import type { SemanticMap } from './template_semantics';

const candidate = {
  locator: '/word/document.xml::body/p[1]',
  kind: 'BODY_PARAGRAPH',
  fingerprint: null,
  textSnippet: 'Số: ...',
  formatting: {
    inTextBox: false,
    styles: [{
      fontFamily: 'Times New Roman', fontSizePoints: 13,
      bold: false, italic: false, color: '000000',
    }],
  },
};

const candidateWithFont = (fontFamily: string) => ({
  ...candidate,
  formatting: {
    ...candidate.formatting,
    styles: [{ ...candidate.formatting.styles[0], fontFamily }],
  },
});

describe('template compiler ownership and readiness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateMany.mockResolvedValue({ count: 1 });
  });

  it('persists renderer candidates and scopes every fusion transition to the owner', async () => {
    mockFindFirst.mockResolvedValue({ id: 't1', docType: 'cong-van', status: 'UPLOADED' });
    (analyzeTemplate as jest.Mock).mockResolvedValue({
      success: true,
      documentFingerprint: 'fp-1',
      candidates: [candidate],
      baselinePages: ['baseline/1.png'],
      labeledPages: ['labeled/1.png'],
      compatibility: [],
    });

    await fuseTemplate('t1', 'u1', {
      templateId: 't1',
      relativePath: 'originals/u1/t1.docx',
      sha256: 'a'.repeat(64),
    });

    expect(mockFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', ownerId: 'u1' },
    }));
    for (const call of mockUpdateMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ id: 't1', ownerId: 'u1' }));
    }
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        previewMetadata: expect.objectContaining({ candidates: [candidate] }),
      }),
    }));
  });

  it('rejects compatibility errors before calling vision and keeps the owner scope', async () => {
    mockFindFirst.mockResolvedValue({ id: 't1', docType: 'cong-van', status: 'UPLOADED' });
    (analyzeTemplate as jest.Mock).mockResolvedValue({
      success: true, documentFingerprint: 'fp-1', candidates: [candidate],
      baselinePages: ['baseline/1.png'], labeledPages: ['labeled/1.png'],
      compatibility: ['AlternateContent:/word/document.xml'],
    });

    await expect(fuseTemplate('t1', 'u1', {
      templateId: 't1', relativePath: 'originals/u1/t1.docx', sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ statusCode: 422, code: 'UNSUPPORTED_DOCX_STRUCTURE' });

    expect(mapTemplateWithVision).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 't1', ownerId: 'u1' },
      data: expect.objectContaining({ status: 'REJECTED', rejectionCode: 'UNSUPPORTED_DOCX_STRUCTURE' }),
    }));
  });

  it('rejects universal typography violations before calling vision', async () => {
    mockFindFirst.mockResolvedValue({ id: 't1', docType: 'cong-van', status: 'UPLOADED' });
    (analyzeTemplate as jest.Mock).mockResolvedValue({
      success: true,
      documentFingerprint: 'fp-1',
      candidates: [candidateWithFont('Arial')],
      baselinePages: ['baseline/1.png'],
      labeledPages: ['labeled/1.png'],
      compatibility: [],
    });

    await expect(fuseTemplate('t1', 'u1', {
      templateId: 't1', relativePath: 'originals/u1/t1.docx', sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ statusCode: 422, code: 'FONT_RULE_VIOLATION' });

    expect(mapTemplateWithVision).not.toHaveBeenCalled();
    expect(mockUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 't1', ownerId: 'u1' },
      data: expect.objectContaining({
        status: 'REJECTED',
        rejectionCode: 'FONT_RULE_VIOLATION',
        rejectionReason: expect.stringContaining('Times New Roman'),
        previewMetadata: expect.objectContaining({
          typographyViolations: expect.arrayContaining([
            expect.objectContaining({ code: 'FONT_FAMILY_INVALID' }),
          ]),
        }),
      }),
    }));
  });

  it('refuses duplicate analysis when the state transition is not claimed', async () => {
    mockFindFirst.mockResolvedValue({ id: 't1', docType: null, status: 'ANALYZING' });
    mockUpdateMany.mockResolvedValueOnce({ count: 0 });
    await expect(fuseTemplate('t1', 'u1', {
      templateId: 't1', relativePath: 'originals/u1/t1.docx', sha256: 'a'.repeat(64),
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(analyzeTemplate).not.toHaveBeenCalled();
  });

  it('rejects a user mapping that contains a locator not produced by the renderer', async () => {
    mockFindFirst.mockResolvedValue({
      id: 't1',
      docType: 'cong-van',
      previewMetadata: {
        candidates: [candidate],
        compatibility: [],
        baselinePages: ['baseline/1.png'],
      },
    });
    const map: SemanticMap = {
      version: 1,
      documentFingerprint: 'fp-1',
      mappings: [{ fieldName: 'document_number', locator: 'forged', kind: 'BODY_PARAGRAPH', confidence: 1 }],
      ignoredLocators: [],
    };

    await expect(recompileSchema('t1', 'u1', map)).rejects.toMatchObject({ statusCode: 422 });
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects two semantic fields targeting the same structural locator', async () => {
    mockFindFirst.mockResolvedValue({
      id: 't1', docType: null,
      previewMetadata: { candidates: [candidate], compatibility: [], baselinePages: ['baseline/1.png'] },
    });
    const map: SemanticMap = {
      version: 1, documentFingerprint: 'fp-1', ignoredLocators: [],
      mappings: [
        { fieldName: 'subject', locator: candidate.locator, kind: candidate.kind, confidence: 1 },
        { fieldName: 'document_number', locator: candidate.locator, kind: candidate.kind, confidence: 1 },
      ],
    };
    await expect(recompileSchema('t1', 'u1', map)).rejects.toMatchObject({
      statusCode: 422, code: 'DUPLICATE_TEMPLATE_LOCATOR',
    });
  });

  it('marks a reviewed mapping READY only when confidence and baseline gates pass', async () => {
    mockFindFirst.mockResolvedValue({
      id: 't1',
      docType: null,
      previewMetadata: {
        candidates: [candidate],
        compatibility: [],
        baselinePages: ['baseline/1.png'],
      },
    });
    const map: SemanticMap = {
      version: 1,
      documentFingerprint: 'fp-1',
      mappings: [{ fieldName: 'document_number', locator: candidate.locator, kind: candidate.kind, confidence: 0.95 }],
      ignoredLocators: [],
    };

    await recompileSchema('t1', 'u1', map);

    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 't1', ownerId: 'u1' },
      data: expect.objectContaining({ status: 'READY', rejectionCode: null }),
    }));
  });

  it('never lets mapping review bypass renderer compatibility errors', async () => {
    mockFindFirst.mockResolvedValue({
      id: 't1', docType: null,
      previewMetadata: {
        candidates: [candidate], compatibility: ['unsupported grouped shape'],
        baselinePages: ['baseline/1.png'], documentFingerprint: 'fp-1',
      },
    });
    const map: SemanticMap = {
      version: 1, documentFingerprint: 'fp-1',
      mappings: [{ fieldName: 'subject', locator: candidate.locator, kind: candidate.kind, confidence: 1 }],
      ignoredLocators: [],
    };
    await recompileSchema('t1', 'u1', map);
    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REJECTED', rejectionCode: 'UNSUPPORTED_DOCX_STRUCTURE' }),
    }));
  });

  it('never lets mapping review promote a typography violation to READY', async () => {
    mockFindFirst.mockResolvedValue({
      id: 't1', docType: null,
      previewMetadata: {
        candidates: [candidateWithFont('Calibri')], compatibility: [],
        baselinePages: ['baseline/1.png'], documentFingerprint: 'fp-1',
      },
    });
    const map: SemanticMap = {
      version: 1, documentFingerprint: 'fp-1', ignoredLocators: [],
      mappings: [{ fieldName: 'document_number', locator: candidate.locator, kind: candidate.kind, confidence: 1 }],
    };

    await recompileSchema('t1', 'u1', map);

    expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'REJECTED',
        rejectionCode: 'FONT_RULE_VIOLATION',
        rejectionReason: expect.stringContaining('Times New Roman'),
      }),
    }));
  });
});
