import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { DOCUMENT_TYPE_IDS } from '../constants/document-types';

export { DOCUMENT_TYPE_IDS } from '../constants/document-types';

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPE_IDS);

const normalizeDocType = <T extends { docType?: string; documentType?: string }>(body: T) => ({
  ...body,
  docType: body.docType ?? body.documentType,
});

const ensureMatchingDocType = (body: { docType?: string; documentType?: string }, ctx: z.RefinementCtx) => {
  if (body.docType && body.documentType && body.docType !== body.documentType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['documentType'],
      message: 'documentType must match docType when both are provided',
    });
  }
};

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

// Validation schemas
export const GenerateDocumentSchema = z.object({
  body: z.object({
    prompt: z.string().trim().min(1).max(10000),
    docType: DocumentTypeSchema.optional(),
    documentType: DocumentTypeSchema.optional(),
    referencePdf: z.string().optional(),
    referenceDocumentId: z.string().min(1).optional(),
    referenceDocumentIds: z.array(z.string().min(1).max(100)).max(20).optional(),
    templateId: z.string().uuid().optional(),
  }).superRefine(ensureMatchingDocType).transform(normalizeDocType),
});

export const ValidateDocumentSchema = z.object({
  body: z.object({
    content: z.string().min(1).max(100000),
    docType: DocumentTypeSchema.optional(),
    documentType: DocumentTypeSchema.optional(),
  })
    .superRefine((body, ctx) => {
      ensureMatchingDocType(body, ctx);
      if (!body.docType && !body.documentType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documentType'],
          message: 'Document type is required',
        });
      }
    })
    .transform(normalizeDocType),
});

export const SearchSchema = z.object({
  body: z.object({
    query: z.string().trim().min(1).max(1000),
    topK: z.coerce.number().int().min(1).max(50).optional(),
    docType: DocumentTypeSchema.optional(),
    documentType: DocumentTypeSchema.optional(),
  }).superRefine(ensureMatchingDocType).transform(normalizeDocType),
});

export const ParseSchema = z.object({
  body: z.object({
    prompt: z.string().trim().min(1).max(10000),
  }),
});

export const FormatSchema = z.object({
  body: z.object({
    content: z.string().min(1).max(200_000),
    docType: DocumentTypeSchema,
    documentType: DocumentTypeSchema.optional(),
    title: z.string().trim().max(200).optional(),
  }).superRefine(ensureMatchingDocType).transform(normalizeDocType),
});

export const FeedbackSchema = z.object({
  body: z.object({
    documentId: z.string().min(1).optional(),
    // H11: cap feedback content to prevent unbounded writes to Postgres.
    originalContent: z.string().min(1).max(200_000).optional(),
    original: z.string().min(1).max(200_000).optional(),
    editedContent: z.string().min(1).max(200_000).optional(),
    edited: z.string().min(1).max(200_000).optional(),
    docType: DocumentTypeSchema.optional(),
    documentType: DocumentTypeSchema.optional(),
    confidence: z.coerce.number().min(0).max(1).optional(),
  })
    .superRefine((body, ctx) => {
      ensureMatchingDocType(body, ctx);

      if (!body.originalContent && !body.original) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['originalContent'],
          message: 'originalContent is required',
        });
      }

      if (!body.editedContent && !body.edited) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['editedContent'],
          message: 'editedContent is required',
        });
      }

      if (!body.documentId && !body.docType && !body.documentType) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['documentType'],
          message: 'documentType is required when documentId is not provided',
        });
      }
    })
    .transform((body) => ({
      ...normalizeDocType(body),
      originalContent: body.originalContent ?? body.original,
      editedContent: body.editedContent ?? body.edited,
    })),
});

/**
 * Structured Output Request Schema
 * POST /api/workflow/structured-output
 */
export const StructuredOutputRequestSchema = z.object({
  body: z
    .object({
      prompt: z.string().trim().min(1).max(10000),
      docType: DocumentTypeSchema.optional(),
      schema: z.record(z.unknown()).superRefine((schema, ctx) => {
        try {
          const serialized = JSON.stringify(schema);
          if (serialized.length > 50_000) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Schema exceeds 50000 characters' });
          }
          const visit = (value: unknown, depth: number): number => {
            if (depth > 12) throw new Error('Schema nesting exceeds 12 levels');
            if (!value || typeof value !== 'object') return 1;
            const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
            if (children.length > 500) throw new Error('Schema collection exceeds 500 entries');
            return 1 + children.reduce((total, child) => total + visit(child, depth + 1), 0);
          };
          if (visit(schema, 0) > 2_000) throw new Error('Schema exceeds 2000 nodes');
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : 'Invalid schema',
          });
        }
      }).optional(),
      model: z.string().trim().min(1).max(200).optional(),
      systemPrompt: z.string().max(2000).optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.coerce.number().int().min(1).max(8_192).optional(),
      strict: z.boolean().optional(),
    })
    .refine(
      (data) => data.docType || data.schema,
      {
        message: 'Either docType or schema must be provided',
        path: ['docType'],
      }
    )
    .transform((body) => ({
      ...body,
      maxTokens: body.maxTokens ?? 4000,
      strict: body.strict !== false, // default true
    })),
});

// File upload schema
export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
export const ALLOWED_MIME_TYPES = ['application/pdf'];
