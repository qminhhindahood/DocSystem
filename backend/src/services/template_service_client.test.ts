const mockPost = jest.fn();

jest.mock('axios', () => ({
  __esModule: true,
  default: { create: () => ({ post: (...args: unknown[]) => mockPost(...args) }) },
}));
jest.mock('../utils/cloud_run_auth', () => ({
  getCloudRunAuthorization: jest.fn().mockResolvedValue({
    'X-Serverless-Authorization': 'Bearer platform-token',
  }),
}));

import { analyzeTemplate, normalizeAnalyzeTemplateOutput } from './template_service_client';

describe('template renderer response normalization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RENDERER_INTERNAL_TOKEN = 'renderer-token-at-least-32-characters';
  });

  it('keeps the renderer token while authenticating private Cloud Run requests', async () => {
    mockPost.mockResolvedValue({ data: { success: true, candidates: [] } });

    await analyzeTemplate({ templateId: 'template-1', relativePath: 'templates/a.docx', sha256: 'abc' });

    expect(mockPost).toHaveBeenCalledWith('/internal/templates/analyze', expect.any(Object), {
      headers: expect.objectContaining({
        'x-renderer-token': expect.any(String),
        'X-Serverless-Authorization': 'Bearer platform-token',
      }),
    });
  });

  it('normalizes candidate typography from snake-case renderer JSON', () => {
    const result = normalizeAnalyzeTemplateOutput({
      success: true,
      document_fingerprint: 'fp-1',
      candidates: [{
        locator: 'p1',
        kind: 'FLOATING_TEXT_BOX',
        fingerprint: { sha256: 'shape-hash' },
        text_snippet: 'Nội dung',
        formatting: {
          in_text_box: true,
          styles: [{
            font_family: 'Times New Roman',
            font_size_points: 14,
            bold: false,
            italic: false,
            color: '000000',
          }],
        },
      }],
      baseline_pages: ['baseline/1.png'],
      labeled_pages: ['labeled/1.png'],
      compatibility: [],
    });

    expect(result.candidates?.[0].formatting).toEqual({
      inTextBox: true,
      styles: [{
        fontFamily: 'Times New Roman',
        fontSizePoints: 14,
        bold: false,
        italic: false,
        color: '000000',
      }],
    });
  });

  it('fails closed when candidate formatting is malformed', () => {
    const result = normalizeAnalyzeTemplateOutput({
      success: true,
      candidates: [{ locator: 'p1', kind: 'BODY_PARAGRAPH', text_snippet: 'Nội dung' }],
    });
    expect(result.candidates?.[0].formatting).toEqual({ inTextBox: false, styles: [] });
  });
});
