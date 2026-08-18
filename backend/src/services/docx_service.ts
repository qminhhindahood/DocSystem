import { Document, Packer, Paragraph, TextRun, AlignmentType, Footer, } from 'docx';
import { DOCUMENT_TYPE_DEFINITIONS, DOCUMENT_TYPE_IDS, DOCUMENT_TYPE_NAMES } from '../constants/document-types';

// ============================================================================
// Vietnamese Government Document Formatting Constants
// ============================================================================
export const VIETNAMESE_GOV_FORMAT = {
  font: 'Times New Roman',
  fontSize: 14,
  pageWidth: 11906,   // A4: 210mm in twips
  pageHeight: 16838,  // A4: 297mm in twips
  margins: {
    top: convertMmToTwip(25),
    bottom: convertMmToTwip(25),
    left: convertMmToTwip(30),
    right: convertMmToTwip(20),
  },
};

function convertMmToTwip(mm: number): number {
  return Math.round(mm * 56.7);
}

// ============================================================================
// Document Type Configuration
// ============================================================================
interface DocTypeConfig {
  title: string;
  headerLines: string[];
  documentNumberLabel?: string;
  signatureBlockLines: string[];
}

const HEADER_LINES = [
  'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
  'Độc lập - Tự do - Hạnh phúc',
  '---o0o---',
];

const DOC_TYPE_CONFIG: Record<string, DocTypeConfig> = Object.fromEntries(
  DOCUMENT_TYPE_IDS.map(id => {
    const definition = DOCUMENT_TYPE_DEFINITIONS[id];
    return [id, {
      title: definition.hasTypeHeading ? definition.title : '',
      headerLines: HEADER_LINES,
      documentNumberLabel: `Số: …/${definition.codePrefix}-[CƠ QUAN]`,
      signatureBlockLines: definition.signatureMode === 'multiple'
        ? [
          '[ĐẠI DIỆN BÊN A]        [ĐẠI DIỆN BÊN B]',
          '[CHỨC VỤ, HỌ TÊN]       [CHỨC VỤ, HỌ TÊN]',
          '[VÙNG KÝ SỐ/ĐÓNG DẤU]   [VÙNG KÝ SỐ/ĐÓNG DẤU]',
        ]
        : [
          '[THẨM QUYỀN KÝ]',
          '[CHỨC VỤ]',
          '[VÙNG KÝ SỐ VÀ ĐÓNG DẤU]',
          '[HỌ VÀ TÊN]',
        ],
    } satisfies DocTypeConfig];
  }),
);

// ============================================================================
// Input / Output Types
// ============================================================================
export interface GenerateDocxInput {
  content: string;
  docType: string;
  title?: string;
}

// ============================================================================
// Public API
// ============================================================================
export async function generateDocumentDocx(input: GenerateDocxInput): Promise<Buffer> {
  const config = DOC_TYPE_CONFIG[input.docType];
  if (!config) {
    throw new Error(
      `Unsupported document type: "${input.docType}". ` +
      `Supported: ${Object.keys(DOC_TYPE_CONFIG).join(', ')}`
    );
  }
  const sections = parseContentSections(input.content, config);
  const doc = buildDocument(sections, config, input.title);
  const buffer = await Packer.toBuffer(doc);
  return buffer;
}

export function getSupportedDocxTypes(): { id: string; name: string }[] {
  return DOCUMENT_TYPE_IDS.map((id) => ({ id, name: DOCUMENT_TYPE_NAMES[id] }));
}

// ============================================================================
// Content Parsing
// ============================================================================
interface Sections {
  header: string[];
  bodyLines: string[];
  signatureBlock: string[];
}

function parseContentSections(
  raw: string,
  config: DocTypeConfig,
): Sections {
  const separator = '---o0o---';
  const parts = raw.split(separator);
  const preSeparator = (parts[0] || '').trim();
  const postSeparator = (parts[1] || '').trim();
  const allLines = preSeparator.split('\n').map(l => l.trim()).filter(Boolean);
  const headerEndIdx = findHeaderEnd(allLines, config.headerLines);
  const header = allLines.slice(0, headerEndIdx);
  const titleLineIdx = allLines.findIndex(
    l => l === config.title || l.toUpperCase() === config.title
  );
  const bodyStart = titleLineIdx >= 0 ? titleLineIdx + 1 : headerEndIdx;
  const bodyLines = allLines.slice(bodyStart);
  const signatureBlock = postSeparator
    ? postSeparator.split('\n').map(l => l.trim()).filter(Boolean)
    : config.signatureBlockLines;
  return { header, bodyLines, signatureBlock };
}

function findHeaderEnd(lines: string[], expectedHeader: string[]): number {
  let matchCount = 0;
  let lastMatchIndex = -1;
  for (let i = 0; i < lines.length && matchCount < expectedHeader.length; i++) {
    const normalized = lines[i].toUpperCase();
    const expected = expectedHeader[matchCount].toUpperCase();
    if (normalized.includes(expected) || expected.includes(normalized)) {
      matchCount++;
      lastMatchIndex = i;
    } else if (matchCount > 0) {
      break;
    }
  }
  // If no header lines matched, return 0 so all lines go into bodyLines.
  // Previously returned expectedHeader.length, which ate first N body lines.
  return lastMatchIndex >= 0 ? lastMatchIndex + 1 : 0;
}

// ============================================================================
// DOCX Document Construction
// ============================================================================
function buildDocument(
  sections: Sections,
  config: DocTypeConfig,
  title?: string,
): Document {
  const fmt = VIETNAMESE_GOV_FORMAT;
  const paragraphGap = 120;
  const children: Paragraph[] = [];

  // Header block (centered, bold)
  for (const line of sections.header) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: paragraphGap / 2 },
        children: [
          new TextRun({
            text: line,
            font: fmt.font,
            size: fmt.fontSize * 2,
            bold: true,
          }),
        ],
      })
    );
  }

  // Document number line
  if (config.documentNumberLabel) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: paragraphGap },
        children: [
          new TextRun({
            text: config.documentNumberLabel,
            font: fmt.font,
            size: fmt.fontSize * 2,
          }),
        ],
      })
    );
    children.push(emptyParagraph(fmt));
  }

  // Agency / Issuer line
  if (sections.bodyLines.length > 0 && isAgencyLine(sections.bodyLines[0])) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: paragraphGap / 2 },
        children: [
          new TextRun({
            text: sections.bodyLines[0],
            font: fmt.font,
            size: fmt.fontSize * 2,
            bold: true,
          }),
        ],
      })
    );
    children.push(emptyParagraph(fmt));
  }

  // Title (centered, bold, uppercase)
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: paragraphGap * 2, after: paragraphGap * 2 },
      children: [
        new TextRun({
          text: config.title,
          font: fmt.font,
          size: fmt.fontSize * 2,
          bold: true,
        }),
      ],
    })
  );

  // Subtitle / "V/v ..." line
  const subtitleIdx = sections.bodyLines.findIndex(
    l => l.startsWith('V/v ') || l.startsWith('V/v')
  );
  if (subtitleIdx >= 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: paragraphGap * 2 },
        children: [
          new TextRun({
            text: sections.bodyLines[subtitleIdx],
            font: fmt.font,
            size: fmt.fontSize * 2,
          }),
        ],
      })
    );
  }

  // Authority line
  const authorityIdx = sections.bodyLines.findIndex(
    l => l.includes('CƠ QUAN CÓ THẨM QUYỀN') || l.includes('Cơ quan có thẩm quyền')
  );
  if (authorityIdx >= 0) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: paragraphGap },
        children: [
          new TextRun({
            text: sections.bodyLines[authorityIdx],
            font: fmt.font,
            size: fmt.fontSize * 2,
          }),
        ],
      })
    );
    children.push(emptyParagraph(fmt));
  }

  // Body content
  const bodyContentIdx = subtitleIdx >= 0
    ? subtitleIdx + 1
    : authorityIdx >= 0
      ? authorityIdx + 1
      : 0;
  const contentLines = sections.bodyLines.slice(bodyContentIdx);
  for (const line of contentLines) {
    if (!line.trim()) continue;
    if (/^Điều\s+\d+\./i.test(line)) {
      // Article header
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: paragraphGap * 2, after: paragraphGap / 2 },
          children: [
            new TextRun({
              text: line,
              font: fmt.font,
              size: fmt.fontSize * 2,
              bold: true,
            }),
          ],
        })
      );
    } else if (/^[IVX]+\./i.test(line) || /^\d+\./i.test(line)) {
      // Roman/arabic numbered clause
      children.push(
        new Paragraph({
          alignment: AlignmentType.LEFT,
          spacing: { before: paragraphGap, after: paragraphGap / 4 },
          indent: { left: convertMmToTwip(10) },
          children: [
            new TextRun({
              text: line,
              font: fmt.font,
              size: fmt.fontSize * 2,
            }),
          ],
        })
      );
    } else {
      // Regular paragraph
      children.push(
        new Paragraph({
          alignment: AlignmentType.JUSTIFIED,
          spacing: { after: paragraphGap / 2 },
          children: [
            new TextRun({
              text: line,
              font: fmt.font,
              size: fmt.fontSize * 2,
            }),
          ],
        })
      );
    }
  }

  // Signature block
  children.push(emptyParagraph(fmt));
  children.push(emptyParagraph(fmt));
  for (const line of sections.signatureBlock) {
    const isBold = /^(TM\.|CHỦ TỊCH|ĐẠI DIỆN)/.test(line);
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { after: paragraphGap / 4 },
        children: [
          new TextRun({
            text: line,
            font: fmt.font,
            size: fmt.fontSize * 2,
            bold: isBold,
          }),
        ],
      })
    );
  }

  const footerContent = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new TextRun({ text: 'Trang ', font: fmt.font, size: fmt.fontSize * 2 }),
    ],
  });

  // Build final document
  const doc = new Document({
    creator: 'AI Document System',
    title: title || 'Vietnamese Government Document',
    description: `Generated ${config.title} document`,
    styles: {
      default: {
        document: {
          run: {
            font: fmt.font,
            size: fmt.fontSize * 2,
          },
        },
      },
    },
    sections: [
      {
        footers: {
          default: new Footer({ children: [footerContent] }),
        },
        properties: {
          page: {
            size: {
              width: fmt.pageWidth,
              height: fmt.pageHeight,
              orientation: 'portrait' as const,
            },
            margin: fmt.margins,
          },
        },
        children,
      },
    ],
  });

  return doc;
}

function emptyParagraph(fmt: typeof VIETNAMESE_GOV_FORMAT): Paragraph {
  return new Paragraph({
    spacing: { after: 60 },
    children: [
      new TextRun({
        text: '',
        font: fmt.font,
        size: fmt.fontSize * 2,
      }),
    ],
  });
}

function isAgencyLine(line: string): boolean {
  const upper = line.toUpperCase();
  if (line.length < 4 || line.length > 80) return false;

  // Negative: exclude known non-agency patterns
  if (/^(ĐIỀU|CĂN|XÉT|QUYẾT|CHỈ|BÁO|CÔNG|THÔNG|KÍNH)\b/.test(upper)) return false;
  if (/^\d+\.\s/.test(upper)) return false; // numbered clauses

  // Positive: match common Vietnamese agency patterns
  return (
    /\b(BỘ|SỞ|ỦY BAN|HỆ THỐNG|CỤC|VỤ|CHI CỤC|PHÒNG|TRƯỜNG|VIỆN|BAN)\b/.test(upper)
    || /\b(CƠ QUAN|ĐƠN VỊ|CỦA)\b/.test(upper)
  );
}
