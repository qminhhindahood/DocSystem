import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

export const validate = (schema: z.ZodTypeAny) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
    }

    const parsed = result.data as { body?: unknown; params?: unknown };
    if (Object.prototype.hasOwnProperty.call(parsed, 'body')) {
      req.body = parsed.body;
    }
    if (Object.prototype.hasOwnProperty.call(parsed, 'params')) {
      req.params = parsed.params as Request['params'];
    }

    next();
  };
};

// File upload limits (PDF conversion uploads)
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ALLOWED_MIME_TYPES = ['application/pdf'];
