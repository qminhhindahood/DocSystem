import type { NextFunction, Request, Response } from 'express';
import { hashUserId, logger as productionLogger } from '../utils/logger';

interface RequestLoggingDependencies {
  logger: Pick<typeof productionLogger, 'info'>;
  now: () => number;
}

const defaultDependencies: RequestLoggingDependencies = {
  logger: productionLogger,
  now: Date.now,
};

export function requestLoggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
  dependencies: RequestLoggingDependencies = defaultDependencies,
): void {
  const startedAt = dependencies.now();
  res.once('finish', () => {
    const routePath = req.route?.path;
    const route = routePath ? `${req.baseUrl || ''}${routePath}` : req.path;
    const userId = req.user?.userId;
    dependencies.logger.info({
      requestId: req.id || 'unknown',
      method: req.method,
      route,
      status: res.statusCode,
      duration: Math.max(0, dependencies.now() - startedAt),
      ...(userId ? { userHash: hashUserId(userId) } : {}),
    }, 'request completed');
  });
  next();
}
