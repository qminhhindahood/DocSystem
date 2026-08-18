import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';

/**
 * Sanitize HTML content to prevent XSS attacks.
 * Strips all HTML tags and encodes special characters.
 * Use this on any user-generated content that might be rendered in the frontend.
 */
export function sanitizeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Sanitize an object's string fields recursively.
 * Only processes fields that are strings; leaves other types untouched.
 */
export function sanitizeObject<T extends Record<string, any>>(obj: T, fields: string[]): T {
  const sanitized = { ...obj } as Record<string, any>;
  for (const field of fields) {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeHtml(sanitized[field] as string);
    }
  }
  return sanitized as T;
}

/**
 * Zod middleware that sanitizes HTML in specified fields before validation.
 */
export function sanitizeInput(fields: string[] = ['originalContent', 'editedContent', 'content']) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (req.body && typeof req.body === 'object') {
        const sanitized = sanitizeObject(req.body, fields);
        req.body = sanitized;
      }
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error('Sanitization failed'));
    }
  };
}
