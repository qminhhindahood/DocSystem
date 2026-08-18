import type { StructuralAnalysis } from '../types/templates';
import type { FieldMapping } from './template_semantics';
import { validateTemplateTypography } from './template_typography_rules';

type Candidate = StructuralAnalysis['candidates'][number];

function candidate(
  style: Partial<NonNullable<Candidate['formatting']>['styles'][number]> = {},
  input: Partial<Candidate> = {},
): Candidate {
  return {
    locator: 'p1',
    kind: 'BODY_PARAGRAPH',
    fingerprint: null,
    textSnippet: 'Nội dung',
    formatting: {
      inTextBox: false,
      styles: [{
        fontFamily: 'Times New Roman',
        fontSizePoints: 14,
        bold: false,
        italic: false,
        color: '000000',
        ...style,
      }],
    },
    ...input,
  };
}

function mapping(fieldName: string): FieldMapping {
  return { fieldName, locator: 'p1', kind: 'BODY_PARAGRAPH', confidence: 1 };
}

describe('template typography rules', () => {
  it.each(['Arial', 'Calibri', ''])('rejects invalid or unresolved font %s', (fontFamily) => {
    expect(validateTemplateTypography(null, [candidate({ fontFamily })], []))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'FONT_FAMILY_INVALID', locator: 'p1' }),
      ]));
  });

  it('rejects non-black text but accepts normalized automatic black', () => {
    expect(validateTemplateTypography(null, [candidate({ color: 'C00000' })], []))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FONT_COLOR_INVALID' })]));
    expect(validateTemplateTypography(null, [candidate({ color: 'auto' })], [])).toEqual([]);
  });

  it('fails closed when text-bearing formatting cannot be resolved', () => {
    const unresolved = candidate({}, { formatting: { inTextBox: false, styles: [] } });
    expect(validateTemplateTypography(null, [unresolved], []))
      .toEqual([expect.objectContaining({ code: 'FONT_FORMAT_UNRESOLVED', locator: 'p1' })]);
  });

  it('accepts compliant body text inside a floating text box', () => {
    const textBox = candidate({}, {
      kind: 'FLOATING_TEXT_BOX',
      formatting: {
        inTextBox: true,
        styles: [{ fontFamily: 'Times New Roman', fontSizePoints: 14, bold: false, italic: false, color: '000000' }],
      },
    });
    expect(validateTemplateTypography('cong-van', [textBox], [mapping('content_items')])).toEqual([]);
  });

  it('requires document numbers to be 13 point regular upright text', () => {
    const violations = validateTemplateTypography('cong-van', [candidate({
      fontSizePoints: 14, bold: true, italic: true,
    })], [mapping('document_number')]);
    expect(violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FONT_SIZE_INVALID', field: 'document_number' }),
      expect.objectContaining({ code: 'FONT_WEIGHT_INVALID', field: 'document_number' }),
      expect.objectContaining({ code: 'FONT_STYLE_INVALID', field: 'document_number' }),
    ]));
  });

  it('requires place and date fields to be 13–14 point italic text', () => {
    for (const fieldName of ['place', 'date_vn']) {
      expect(validateTemplateTypography('cong-van', [candidate({ fontSizePoints: 13, italic: true })], [mapping(fieldName)]))
        .toEqual([]);
      expect(validateTemplateTypography('cong-van', [candidate({ fontSizePoints: 12, italic: false })], [mapping(fieldName)]))
        .toEqual(expect.arrayContaining([
          expect.objectContaining({ code: 'FONT_SIZE_INVALID', field: fieldName }),
          expect.objectContaining({ code: 'FONT_STYLE_INVALID', field: fieldName }),
        ]));
    }
  });

  it('uses the công văn subject rule and the named-document subject rule', () => {
    expect(validateTemplateTypography('cong-van', [candidate({ fontSizePoints: 12, bold: false })], [mapping('subject')]))
      .toEqual([]);
    expect(validateTemplateTypography('thong-bao', [candidate({ fontSizePoints: 14, bold: true })], [mapping('subject')]))
      .toEqual([]);
    expect(validateTemplateTypography('cong-van', [candidate({ fontSizePoints: 14, bold: true })], [mapping('subject')]))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'FONT_SIZE_INVALID' })]));
  });

  it('enforces body, distribution, and signatory ranges', () => {
    expect(validateTemplateTypography('thong-bao', [candidate({ fontSizePoints: 13 })], [mapping('content_items')]))
      .toEqual([]);
    expect(validateTemplateTypography('thong-bao', [candidate({ fontSizePoints: 11 })], [mapping('distribution_list')]))
      .toEqual([]);
    for (const fieldName of ['signatory_name', 'signatory_title']) {
      expect(validateTemplateTypography('thong-bao', [candidate({ fontSizePoints: 14, bold: true })], [mapping(fieldName)]))
        .toEqual([]);
    }
  });
});
