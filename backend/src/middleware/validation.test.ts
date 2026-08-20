import { validate, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from './validation';
import { z } from 'zod';

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

const SampleSchema = z.object({
  body: z.object({
    prompt: z.string().trim().min(1).max(100),
  }),
});

describe('validate middleware', () => {
  it('passes parsed body through to the handler', () => {
    const req: any = {
      body: { prompt: 'Convert this PDF' },
      query: {},
      params: {},
    };
    const res = createResponse();
    const next = jest.fn();

    validate(SampleSchema)(req, res as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.body).toMatchObject({ prompt: 'Convert this PDF' });
  });

  it('rejects invalid bodies with a 400 response', () => {
    const req: any = {
      body: { prompt: '   ' },
      query: {},
      params: {},
    };
    const res = createResponse();
    const next = jest.fn();

    validate(SampleSchema)(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Validation failed' }),
    );
  });

  it('exposes PDF upload limits for the conversion surface', () => {
    expect(MAX_FILE_SIZE).toBe(50 * 1024 * 1024);
    expect(ALLOWED_MIME_TYPES).toEqual(['application/pdf']);
  });
});
