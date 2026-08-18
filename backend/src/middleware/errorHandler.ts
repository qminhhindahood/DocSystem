import { Request, Response, NextFunction } from 'express';
import { NotFoundError, ValidationError } from '../utils/errors';

export function errorHandler(
	err: Error,
	req: Request,
	res: Response,
	_next: NextFunction,
): void {
	console.error('[error]', err.message, { path: req.path, method: req.method, stack: err.stack });

	const statusCode =
	err instanceof NotFoundError ? 404 :
	err instanceof ValidationError ? 400 :
	(err as any).code === 'P2025' ? 404 :
	500;
	// M10 fix: do NOT leak err.message to client for 500s — only for known 4xx/expected 5xx
	const clientMessage =
	statusCode < 500
		? err.message
		: 'An internal error occurred. Please try again later.';
	res.status(statusCode).json({
	error: clientMessage,
	...(process.env.ALLOW_STACK_TRACES === 'true' && { stack: err.stack }),
	});
}
