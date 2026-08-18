/**
 * Structured Output Integration Tests
 * Run: npm test -- workflow.structured_output.test.ts
 */

import request from 'supertest';
import { app } from '../src/index';
import { generateToken } from '../src/middleware/user_auth';
import { callLLM } from '../src/services/llm_config_service';

jest.mock('../src/middleware/user_auth', () => {
  const actual = jest.requireActual('../src/middleware/user_auth');
  return {
    ...actual,
    generateToken: actual.generateToken,
  };
});

jest.mock('../src/utils/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'test-user',
        username: 'testuser',
        isDisabled: false,
        sessionVersion: 0,
      }),
    },
    userLLMConfig: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
  },
}));

jest.mock('../src/services/llm_config_service', () => ({
  getLLMConfig: jest.fn().mockResolvedValue({
    provider: 'lmstudio',
    baseUrl: 'http://localhost:1234',
    model: 'test-model',
  }),
  callLLM: jest.fn().mockImplementation(async (config: any, messages: any[], options: any) => {
    if (options?.response_format?.json_schema?.schema?.properties?.title) {
      return JSON.stringify({
        title: 'Tóm tắt quy định mới',
        summary: 'Nội dung tóm tắt',
        items: ['mục 1', 'mục 2'],
      });
    }
    return JSON.stringify({
      agency_name: 'Bộ Công an',
      document_number: '123/QĐ-BCA',
      place: 'Hà Nội',
      date_vn: '21/06/2026',
      subject: 'Quyết định ban hành quy chế đào tạo mới',
      legal_basis: 'Căn cứ Luật Tổ chức Chính phủ ngày 19 tháng 6 năm 2015',
      signatory_name: 'Nguyễn Văn A',
      signatory_title: 'Bộ trưởng',
    });
  }),
}));

const token = generateToken({ userId: 'test-user', username: 'testuser' });
const authHeader = { Authorization: `Bearer ${token}` };

describe('POST /api/workflow/structured-output', () => {
  it('should return structured output using docType template', async () => {
    const response = await request(app)
      .post('/api/workflow/structured-output')
      .set(authHeader)
      .send({
        prompt: 'Tạo quyết định về ban hành quy chế đào tạo',
        docType: 'quyet-dinh',
        temperature: 0.1,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeDefined();
    expect(response.body.model).toBeDefined();

    // Validate required fields from quyet-dinh template
    const data = response.body.data;
    expect(data).toHaveProperty('agency_name');
    expect(data).toHaveProperty('document_number');
    expect(data).toHaveProperty('place');
    expect(data).toHaveProperty('date_vn');
    expect(data).toHaveProperty('subject');
    expect(data).toHaveProperty('legal_basis');
    expect(data).toHaveProperty('signatory_name');
    expect(data).toHaveProperty('signatory_title');
  });

  it('should return structured output using custom schema', async () => {
    const customSchema = {
      type: 'object',
      properties: {
        title: { type: 'string' },
        summary: { type: 'string' },
        items: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'summary'],
    };

    const response = await request(app)
      .post('/api/workflow/structured-output')
      .set(authHeader)
      .send({
        prompt: 'Tóm tắt văn bản: Ban hành quy định mới về đào tạo',
        schema: customSchema,
      })
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('title');
    expect(response.body.data).toHaveProperty('summary');
  });

  it('should reject request without docType or schema', async () => {
    const response = await request(app)
      .post('/api/workflow/structured-output')
      .set(authHeader)
      .send({
        prompt: 'Test',
      })
      .expect(400);

    expect(response.body.error).toBe('Validation failed');
  });

  it('should handle invalid docType gracefully', async () => {
    const response = await request(app)
      .post('/api/workflow/structured-output')
      .set(authHeader)
      .send({
        prompt: 'Test',
        docType: 'invalid-type',
      })
      .expect(400);

    expect(response.body.error).toContain('Validation');
  });

  it('does not log raw private output when structured JSON parsing fails', async () => {
    const privateOutput = 'PRIVATE-STRUCTURED-OUTPUT-not-json';
    (callLLM as jest.Mock).mockResolvedValueOnce(privateOutput);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await request(app)
      .post('/api/workflow/structured-output')
      .set(authHeader)
      .send({ prompt: 'Private request', docType: 'quyet-dinh' })
      .expect(500);

    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).not.toContain(privateOutput);
    errorSpy.mockRestore();
  });
});
