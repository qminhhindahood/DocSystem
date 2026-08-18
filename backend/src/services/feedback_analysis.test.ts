import { analyzeFeedback, tokenize, jaccardSimilarity, LEGAL_PATTERNS, FORMAT_PATTERNS } from './feedback_analysis';

describe('tokenize', () => {
  it('should normalize Vietnamese text and split into words', () => {
    const tokens = tokenize('Cộng hòa xã hội chủ nghĩa Việt Nam');
    expect(tokens).toContain('cong');
    expect(tokens).toContain('hoa');
    expect(tokens).toContain('xa');
    expect(tokens).toContain('hoi');
    expect(tokens).toContain('chu');
    expect(tokens).toContain('nghia');
    expect(tokens).toContain('viet');
    expect(tokens).toContain('nam');
  });

  it('should handle English text', () => {
    const tokens = tokenize('hello world test');
    expect(tokens).toEqual(['hello', 'world', 'test']);
  });

  it('should filter out empty strings', () => {
    const tokens = tokenize('  hello   world  ');
    expect(tokens).not.toContain('');
    expect(tokens.length).toBe(2);
  });
});

describe('jaccardSimilarity', () => {
  it('should return 1 for identical texts', () => {
    const similarity = jaccardSimilarity('hello world', 'hello world');
    expect(similarity).toBe(1);
  });

  it('should return 0 for completely different texts', () => {
    const similarity = jaccardSimilarity('aaa bbb', 'ccc ddd');
    expect(similarity).toBe(0);
  });

  it('should return partial similarity for overlapping texts', () => {
    const similarity = jaccardSimilarity('hello world', 'hello there');
    // Common: hello, Union: {hello, world, there} = 1/3
    expect(similarity).toBeCloseTo(0.333, 2);
  });
});

describe('analyzeFeedback - Legal Changes', () => {
  it('should classify legal reference change as critical', () => {
    const original = 'Theo Điều 5 Khoản 1 Nghị định 30/2020/NĐ-CP';
    const edited = 'Theo Điều 6 Khoản 2 Nghị định 30/2020/NĐ-CP';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('legal');
    expect(result.classification.priority).toBe('critical');
    expect(result.classification.affectsCompliance).toBe(true);
    expect(result.diff.legalChanges.length).toBeGreaterThan(0);
  });

  it('should detect removal of legal citation', () => {
    const original = 'Căn cứ Luật Doanh nghiệp 2020 và Nghị định 30/2020/NĐ-CP';
    const edited = 'Căn cứ quy định hiện hành';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('legal');
    expect(result.classification.priority).toBe('critical');
    expect(result.diff.legalChanges.some(c => c.removed.length > 0)).toBe(true);
  });

  it('should detect addition of legal citation', () => {
    const original = 'Quy định theo quy định nội bộ';
    const edited = 'Quy định theo Thông tư 01/2021/TT-BTTTT';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('legal');
    expect(result.classification.priority).toBe('critical');
    expect(result.diff.legalChanges.some(c => c.added.length > 0)).toBe(true);
  });
});

describe('analyzeFeedback - Formatting Changes', () => {
  it('should classify header removal as high priority with compliance impact', () => {
    const original = 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM\nĐộc lập - Tự do - Hạnh phúc';
    const edited = 'Độc lập - Tự do - Hạnh phúc';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('formatting');
    expect(result.classification.priority).toBe('high');
    expect(result.classification.affectsCompliance).toBe(true);
    expect(result.diff.formattingChanges.some(c => c.kind === 'header' && c.presentInOriginal && !c.presentInEdited)).toBe(true);
  });

  it('should detect signature block removal', () => {
    const original = 'Hà Nội, ngày 15 tháng 05 năm 2024\n\nCHỦ TỊCH\nKý tên\nđóng dấu';
    const edited = 'Hà Nội, ngày 15 tháng 05 năm 2024';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('formatting');
    expect(result.classification.priority).toBe('high');
    expect(result.classification.affectsCompliance).toBe(true);
  });

  it('should detect document number changes', () => {
    const original = 'Số: 123/2024/QĐ-UBND';
    const edited = 'Số: 456/2024/QĐ-UBND';

    const result = analyzeFeedback(original, edited);

    expect(result.diff.formattingChanges.some(c => c.kind === 'document_number' && c.presentInOriginal && c.presentInEdited)).toBe(true);
  });
});

describe('analyzeFeedback - Content Types', () => {
  it('should classify additions correctly', () => {
    const original = 'Điều 1. Quy định chung';
    const edited = 'Điều 1. Quy định chung\n\nĐiều 2. Quy định chi tiết';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.primaryType).toBe('addition');
    expect(result.diff.additions.length).toBeGreaterThan(0);
  });

  it('should classify deletions correctly', () => {
    const original = 'Điều 1. Quy định chung\n\nĐiều 2. Quy định chi tiết';
    const edited = 'Điều 1. Quy định chung';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.primaryType).toBe('deletion');
    expect(result.diff.deletions.length).toBeGreaterThan(0);
  });

  it('should classify modifications correctly', () => {
    const original = 'Điều 1. Quy định chung';
    const edited = 'Điều 1. Quy định chung và riêng';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.primaryType).toBe('modification');
  });
});

describe('analyzeFeedback - Minor Changes', () => {
  it('should classify small wording change as wording with medium priority', () => {
    const original = 'Quy định về quản lý nhà nước';
    const edited = 'Quy định về công tác quản lý nhà nước';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).not.toBe('legal');
    expect(result.classification.subType).not.toBe('formatting');
    expect(result.classification.priority).toBe('medium');
  });

  it('should classify identical content as correction with low priority', () => {
    const original = 'Nội dung văn bản không thay đổi';
    const edited = 'Nội dung văn bản không thay đổi';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('correction');
    expect(result.classification.priority).toBe('low');
    expect(result.diff.jaccardSimilarity).toBe(1);
  });

  it('should classify very similar content as correction', () => {
    const original = 'Đây là nội dung của văn bản quy phạm pháp luật';
    const edited = 'Đây là nội dung của văn bản quy phạm pháp luật';

    const result = analyzeFeedback(original, edited);

    expect(result.diff.jaccardSimilarity).toBe(1);
  });
});

describe('analyzeFeedback - Structural Changes', () => {
  it('should classify 3+ line additions as structural with high priority', () => {
    const original = 'Line 1\nLine 2';
    const edited = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('structural');
    expect(result.classification.priority).toBe('high');
  });

  it('should classify 3+ line deletions as structural with high priority', () => {
    const original = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\nLine 6';
    const edited = 'Line 1\nLine 2';

    const result = analyzeFeedback(original, edited);

    expect(result.classification.subType).toBe('structural');
    expect(result.classification.priority).toBe('high');
  });
});

describe('analyzeFeedback - Error Handling', () => {
  it('should throw error when content is too short', () => {
    const original = 'a';
    const edited = 'b';

    expect(() => analyzeFeedback(original, edited)).toThrow();
  });

  it('should throw error when original content is empty', () => {
    const original = '';
    const edited = 'some content';

    expect(() => analyzeFeedback(original, edited)).toThrow();
  });
});

describe('analyzeFeedback - Diff Output', () => {
  it('should provide changedLines with line numbers', () => {
    const original = 'Line 1\nLine 2\nLine 3';
    const edited = 'Line 1\nLine 2 Modified\nLine 3';

    const result = analyzeFeedback(original, edited);

    expect(result.diff.changedLines.length).toBeGreaterThan(0);
    expect(result.diff.changedLines[0]).toHaveProperty('line');
    expect(result.diff.changedLines[0]).toHaveProperty('original');
    expect(result.diff.changedLines[0]).toHaveProperty('edited');
  });

  it('should calculate similarity score', () => {
    const original = 'Hello world';
    const edited = 'Hello universe';

    const result = analyzeFeedback(original, edited);

    expect(result.diff.jaccardSimilarity).toBeGreaterThanOrEqual(0);
    expect(result.diff.jaccardSimilarity).toBeLessThanOrEqual(1);
  });

  it('should include legalChanges array even when empty', () => {
    const original = 'Regular content without legal references';
    const edited = 'Regular content with minor changes';

    const result = analyzeFeedback(original, edited);

    expect(Array.isArray(result.diff.legalChanges)).toBe(true);
  });

  it('should include formattingChanges array', () => {
    const original = 'Some text content here';
    const edited = 'Some different text content here';

    const result = analyzeFeedback(original, edited);

    expect(Array.isArray(result.diff.formattingChanges)).toBe(true);
    expect(result.diff.formattingChanges.some(c => c.kind === 'header')).toBe(true);
    expect(result.diff.formattingChanges.some(c => c.kind === 'signature_block')).toBe(true);
    expect(result.diff.formattingChanges.some(c => c.kind === 'date_format')).toBe(true);
    expect(result.diff.formattingChanges.some(c => c.kind === 'document_number')).toBe(true);
  });
});