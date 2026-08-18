import { validate, GenerateDocumentSchema, FeedbackSchema, StructuredOutputRequestSchema } from './validation';

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('validate middleware', () => {
  it('accepts documentType and normalizes it to docType for generation requests', () => {
    const req: any = {
      body: { prompt: 'Draft an official letter', documentType: 'cong-van' },
      query: {},
      params: {},
    };
    const res = createResponse();
    const next = jest.fn();

    validate(GenerateDocumentSchema as any)(req, res as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body).toMatchObject({
      prompt: 'Draft an official letter',
      docType: 'cong-van',
      documentType: 'cong-van',
    });
  });

  it('rejects blank generation prompts with a 400 response', () => {
    const req: any = {
      body: { prompt: '   ', documentType: 'cong-van' },
      query: {},
      params: {},
    };
    const res = createResponse();
    const next = jest.fn();

    validate(GenerateDocumentSchema as any)(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation failed' }),
    );
  });

  it('normalizes legacy feedback field names from the frontend', () => {
    const req: any = {
      body: {
        original: 'before',
        edited: 'after',
        documentType: 'cong-van',
      },
      query: {},
      params: {},
    };
    const res = createResponse();
    const next = jest.fn();

    validate(FeedbackSchema as any)(req, res as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.body).toMatchObject({
      originalContent: 'before',
      editedContent: 'after',
      docType: 'cong-van',
    });
  });

  it('bounds structured output tokens and custom schema complexity', () => {
    const oversizedTokens = StructuredOutputRequestSchema.safeParse({
      body: { prompt: 'Generate', docType: 'cong-van', maxTokens: 8_193 },
    });
    expect(oversizedTokens.success).toBe(false);

    let nested: Record<string, unknown> = { type: 'string' };
    for (let depth = 0; depth < 14; depth += 1) nested = { properties: nested };
    const excessiveSchema = StructuredOutputRequestSchema.safeParse({
      body: { prompt: 'Generate', schema: nested },
    });
    expect(excessiveSchema.success).toBe(false);
  });
});
