const mockTemplateFindFirst = jest.fn();
const mockDocumentFindMany = jest.fn();
const mockDocumentCreate = jest.fn();
const mockDocumentUpdateMany = jest.fn();
const mockStructuredGenerate = jest.fn();
const mockGetDocumentProfile = jest.fn();
const mockReserveDocumentNumber = jest.fn();
const mockRenderTemplate = jest.fn();

jest.mock('../utils/prisma', () => ({
  prisma: {
    template: { findFirst: (...args: unknown[]) => mockTemplateFindFirst(...args) },
    document: {
      findMany: (...args: unknown[]) => mockDocumentFindMany(...args),
      create: (...args: unknown[]) => mockDocumentCreate(...args),
      updateMany: (...args: unknown[]) => mockDocumentUpdateMany(...args),
    },
  },
}));

jest.mock('./structured_output_service', () => ({
  structuredOutputService: { generate: (...args: unknown[]) => mockStructuredGenerate(...args) },
}));

jest.mock('./document_profile_service', () => ({
  getDocumentProfile: (...args: unknown[]) => mockGetDocumentProfile(...args),
  reserveDocumentNumber: (...args: unknown[]) => mockReserveDocumentNumber(...args),
}));

jest.mock('./template_service_client', () => ({
  renderTemplateDocument: (...args: unknown[]) => mockRenderTemplate(...args),
}));

import { checkFidelity, generateTemplateDocument } from './template_generation_service';

const strictSchema = {
  type: 'object',
  properties: {
    agency_name: { type: 'string' },
    place: { type: 'string' },
    date_vn: { type: 'string' },
    document_number: { type: 'string' },
    subject: { type: 'string' },
  },
  required: ['subject'],
  additionalProperties: false,
};

describe('generateTemplateDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTemplateFindFirst.mockResolvedValue({
      id: 't1', ownerId: 'u1', status: 'READY', name: 'Official letter',
      docType: 'cong-van', originalPath: 'originals/u1/t1.docx',
      generationSchema: {
        jsonSchema: strictSchema,
        fields: [{ name: 'subject', locator: '/word/document.xml::body/p[1]' }],
      },
    });
    mockDocumentFindMany.mockResolvedValue([{ id: 'r1', title: 'Reference', content: 'Owned evidence' }]);
    mockGetDocumentProfile.mockResolvedValue({
      agencyName: 'Agency A', defaultPlace: 'Hà Nội', defaultRecipients: ['Office B'],
      signatoryName: 'Nguyễn Văn A', signatoryTitle: 'Giám đốc',
    });
    mockReserveDocumentNumber.mockResolvedValue('42/ABC');
    mockStructuredGenerate.mockResolvedValue({
      data: { agency_name: 'wrong', place: 'wrong', date_vn: 'wrong', document_number: 'wrong', subject: 'Subject' },
      model: 'test',
    });
    mockDocumentCreate.mockResolvedValue({ id: 'd1' });
    mockDocumentUpdateMany.mockResolvedValue({ count: 1 });
    mockRenderTemplate.mockResolvedValue({
      success: true,
      output_relative_path: 'generated/u1/d1.docx',
      output_sha256: 'b'.repeat(64),
      output_size: 1200,
      fidelity_report: {
        passed: true, violations: [], repairs: [], pageCount: 2,
        warnings: [], validationStatus: 'passed',
      },
    });
  });

  it('returns 404 for a foreign template and 409 for a non-READY owned template', async () => {
    mockTemplateFindFirst.mockResolvedValueOnce(null);
    await expect(generateTemplateDocument({ ownerId: 'u1', templateId: 'foreign', prompt: 'Draft' }))
      .rejects.toMatchObject({ statusCode: 404 });

    mockTemplateFindFirst.mockResolvedValueOnce({ id: 't1', status: 'NEEDS_REVIEW' });
    await expect(generateTemplateDocument({ ownerId: 'u1', templateId: 't1', prompt: 'Draft' }))
      .rejects.toMatchObject({ statusCode: 409 });
  });

  it('owner-filters references, applies the stored strict schema, overrides deterministic fields, and verifies storage', async () => {
    const result = await generateTemplateDocument({
      ownerId: 'u1', templateId: 't1', prompt: 'Draft', referenceDocumentIds: ['r1', 'foreign'],
    });

    expect(mockDocumentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['r1', 'foreign'] }, ownerId: 'u1' },
    }));
    expect(mockStructuredGenerate).toHaveBeenCalledWith(expect.objectContaining({
      schema: strictSchema,
      strict: true,
      userId: 'u1',
    }));
    expect(mockRenderTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template_id: 't1', owner_id: 'u1', document_id: 'd1',
      values: expect.objectContaining({
        agency_name: 'Agency A', place: 'Hà Nội', document_number: '42/ABC', subject: 'Subject',
      }),
    }), undefined);
    expect((mockRenderTemplate.mock.calls[0][0].values as Record<string, unknown>).date_vn).not.toBe('wrong');
    expect(mockDocumentCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ ownerId: 'u1', metadata: expect.objectContaining({ generation: expect.objectContaining({ state: 'rendering' }) }) }),
    }));
    expect(mockDocumentUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'd1', ownerId: 'u1' },
      data: expect.objectContaining({
        storageKey: 'generated/u1/d1.docx',
        metadata: expect.objectContaining({ generation: expect.objectContaining({ state: 'verified' }) }),
      }),
    }));
    expect(result).toMatchObject({ documentId: 'd1', storageKey: 'generated/u1/d1.docx' });
  });

  it('stores a structurally valid deliverable with visual fidelity warnings', async () => {
    mockRenderTemplate.mockResolvedValueOnce({
      success: true,
      output_relative_path: 'generated/u1/d1.docx',
      output_sha256: 'd'.repeat(64),
      output_size: 1000,
      fidelity_report: {
        passed: false, violations: [], repairs: [], pageCount: 3,
        validationStatus: 'warnings',
        warnings: [{ code: 'PAGE_COUNT_CHANGED', severity: 'high', message: 'Page count changed' }],
      },
    });

    const result = await generateTemplateDocument({ ownerId: 'u1', templateId: 't1', prompt: 'Draft' });

    expect(result.fidelityReport.validationStatus).toBe('warnings');
    expect(result.fidelityReport.warnings).toEqual([
      expect.objectContaining({ code: 'PAGE_COUNT_CHANGED', severity: 'high' }),
    ]);
    expect(mockDocumentUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        storageKey: 'generated/u1/d1.docx',
        metadata: expect.objectContaining({ generation: expect.objectContaining({
          state: 'verified', validationStatus: 'warnings',
        }) }),
      }),
    }));
  });

  it('never exposes a deliverable when structural rendering fails', async () => {
    mockRenderTemplate.mockResolvedValueOnce({
      success: false,
      fidelity_report: {
        passed: false, violations: [{ code: 'SHAPE_MOVED', message: 'shape moved' }], repairs: [], pageCount: 2,
        warnings: [], validationStatus: 'unavailable',
      },
    });

    await expect(generateTemplateDocument({ ownerId: 'u1', templateId: 't1', prompt: 'Draft' }))
      .rejects.toMatchObject({ statusCode: 422 });
    expect(mockDocumentUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: 'd1', ownerId: 'u1' },
      data: expect.objectContaining({
        storageKey: null,
        metadata: expect.objectContaining({ generation: expect.objectContaining({ state: 'failed' }) }),
      }),
    }));
  });

  it('performs exactly one field-bounded shortening regeneration', async () => {
    mockRenderTemplate
      .mockResolvedValueOnce({
        success: true, output_relative_path: 'generated/u1/d1.docx', output_sha256: 'b'.repeat(64), output_size: 1200,
        fidelity_report: {
          passed: false, violations: [], repairs: [], pageCount: 5,
          warnings: [{ code: 'POSSIBLE_OVERFLOW', severity: 'high', message: 'overflow' }],
          validationStatus: 'warnings',
        },
        shorten_required: { field: 'subject', max_characters: 40 },
      })
      .mockResolvedValueOnce({
        success: true, output_relative_path: 'generated/u1/d1.docx', output_sha256: 'c'.repeat(64), output_size: 900,
        fidelity_report: {
          passed: true, violations: [], repairs: [{ policy: 'shorten', field: 'subject' }], pageCount: 2,
          warnings: [], validationStatus: 'passed',
        },
      });
    mockStructuredGenerate
      .mockResolvedValueOnce({ data: { agency_name: 'wrong', place: 'wrong', date_vn: 'wrong', document_number: 'wrong', subject: 'Long subject' }, model: 'test' })
      .mockResolvedValueOnce({ data: { subject: 'Short subject' }, model: 'test' });

    await generateTemplateDocument({ ownerId: 'u1', templateId: 't1', prompt: 'Draft' });

    expect(mockRenderTemplate).toHaveBeenCalledTimes(2);
    expect(mockStructuredGenerate).toHaveBeenCalledTimes(2);
    expect(mockStructuredGenerate).toHaveBeenLastCalledWith(expect.objectContaining({
      schema: expect.objectContaining({
        properties: { subject: { type: 'string', maxLength: 40 } },
        required: ['subject'], additionalProperties: false,
      }),
    }));
    expect(mockRenderTemplate.mock.calls[1][0].values.subject).toBe('Short subject');
  });

  it('preserves the first valid render when optional shortening fails', async () => {
    mockRenderTemplate.mockResolvedValueOnce({
      success: true, output_relative_path: 'generated/u1/d1.docx', output_sha256: 'e'.repeat(64), output_size: 1300,
      fidelity_report: {
        passed: false, violations: [], repairs: [], pageCount: 5,
        warnings: [{ code: 'POSSIBLE_OVERFLOW', severity: 'high', message: 'overflow' }],
        validationStatus: 'warnings',
      },
      shorten_required: { field: 'subject', max_characters: 40 },
    });
    mockStructuredGenerate
      .mockResolvedValueOnce({ data: { agency_name: 'wrong', place: 'wrong', date_vn: 'wrong', document_number: 'wrong', subject: 'Long subject' }, model: 'test' })
      .mockRejectedValueOnce(new Error('shortening unavailable'));

    const result = await generateTemplateDocument({ ownerId: 'u1', templateId: 't1', prompt: 'Draft' });

    expect(mockRenderTemplate).toHaveBeenCalledTimes(1);
    expect(result.outputSha256).toBe('e'.repeat(64));
    expect(result.fidelityReport.warnings).toContainEqual(expect.objectContaining({
      code: 'SHORTENING_FAILED', severity: 'warning',
    }));
    expect(mockDocumentUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ storageKey: 'generated/u1/d1.docx' }),
    }));
  });
});

describe('checkFidelity', () => {
  it('passes when all fields are filled', () => {
    const result = checkFidelity({ agency_name: true, subject: true, signatory_name: true });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('reports unset fields as violations', () => {
    const result = checkFidelity({ agency_name: true, subject: false, signatory_name: true });
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].field).toBe('subject');
    expect(result.violations[0].code).toBe('UNSET_FIELD');
  });

  it('reports multiple unset fields', () => {
    const result = checkFidelity({ a: false, b: false, c: true });
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(2);
  });
});
