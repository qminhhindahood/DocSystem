import type { StructuralAnalysis, TypographyViolation } from '../types/templates';
import type { FieldMapping } from './template_semantics';

type Candidate = StructuralAnalysis['candidates'][number];
type RoleRule = { min: number; max: number; bold?: boolean; italic?: boolean };

const ROLE_RULES: Record<string, RoleRule> = {
  agency_name: { min: 12, max: 13 },
  document_number: { min: 13, max: 13, bold: false, italic: false },
  place: { min: 13, max: 14, italic: true },
  date_vn: { min: 13, max: 14, italic: true },
  recipient: { min: 13, max: 14, italic: false },
  legal_basis: { min: 13, max: 14, italic: true },
  content_items: { min: 13, max: 14, italic: false },
  distribution_list: { min: 11, max: 12 },
  signatory_name: { min: 13, max: 14, bold: true },
  signatory_title: { min: 13, max: 14, bold: true },
  security_level: { min: 13, max: 14, bold: true },
  urgency_level: { min: 13, max: 14, bold: true },
  circulation_instructions: { min: 13, max: 14, bold: true },
  agency_address: { min: 11, max: 12 },
  agency_email: { min: 11, max: 12 },
  agency_website: { min: 11, max: 12 },
  agency_phone: { min: 11, max: 12 },
};

export function validateTemplateTypography(
  docType: string | null,
  candidates: Candidate[],
  mappings: FieldMapping[],
): TypographyViolation[] {
  const violations: TypographyViolation[] = [];
  const mappingsByLocator = new Map(
    mappings.filter(mapping => mapping.locator).map(mapping => [mapping.locator!, mapping]),
  );

  for (const candidate of candidates) {
    if (!candidate.textSnippet.trim()) continue;
    const styles = candidate.formatting?.styles ?? [];
    if (styles.length === 0) {
      violations.push(violation(
        'FONT_FORMAT_UNRESOLVED', candidate, undefined, 'unresolved',
        'Times New Roman with an explicit compliant size and style',
      ));
      continue;
    }

    const mapping = mappingsByLocator.get(candidate.locator);
    const rule = mapping ? roleRule(docType, mapping.fieldName) : undefined;
    for (const style of styles) {
      if (style.fontFamily.trim().toLocaleLowerCase('en-US') !== 'times new roman') {
        violations.push(violation(
          'FONT_FAMILY_INVALID', candidate, mapping?.fieldName,
          style.fontFamily || 'unresolved', 'Times New Roman',
        ));
      }
      const color = style.color.trim().toUpperCase();
      if (color !== '000000' && color !== 'AUTO') {
        violations.push(violation(
          'FONT_COLOR_INVALID', candidate, mapping?.fieldName,
          style.color || 'unresolved', '000000 (black)',
        ));
      }
      if (!rule) continue;
      if (style.fontSizePoints === null ||
          style.fontSizePoints < rule.min || style.fontSizePoints > rule.max) {
        violations.push(violation(
          'FONT_SIZE_INVALID', candidate, mapping?.fieldName,
          style.fontSizePoints === null ? 'unresolved' : `${style.fontSizePoints} pt`,
          rule.min === rule.max ? `${rule.min} pt` : `${rule.min}–${rule.max} pt`,
        ));
      }
      if (rule.bold !== undefined && style.bold !== rule.bold) {
        violations.push(violation(
          'FONT_WEIGHT_INVALID', candidate, mapping?.fieldName,
          style.bold ? 'bold' : 'regular', rule.bold ? 'bold' : 'regular',
        ));
      }
      if (rule.italic !== undefined && style.italic !== rule.italic) {
        violations.push(violation(
          'FONT_STYLE_INVALID', candidate, mapping?.fieldName,
          style.italic ? 'italic' : 'upright', rule.italic ? 'italic' : 'upright',
        ));
      }
    }
  }
  return violations;
}

function roleRule(docType: string | null, fieldName: string): RoleRule | undefined {
  if (fieldName === 'subject') {
    return docType === 'cong-van'
      ? { min: 12, max: 13, bold: false, italic: false }
      : { min: 13, max: 14, bold: true, italic: false };
  }
  return ROLE_RULES[fieldName];
}

function violation(
  code: TypographyViolation['code'],
  candidate: Candidate,
  field: string | undefined,
  actual: string,
  expected: string,
): TypographyViolation {
  return {
    code,
    locator: candidate.locator,
    ...(field ? { field } : {}),
    actual,
    expected,
  };
}
