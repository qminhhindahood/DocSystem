import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      abortSignal: AbortSignal;
    }
  }
}

export interface TimeoutOptions {
  ms: number;
  message?: string;
}

export const requestTimeout = (options: TimeoutOptions) => {
  const { ms, message = 'Request timeout' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    const controller = new AbortController();
    req.abortSignal = controller.signal;
    const abort = (reason: Error) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const timer = setTimeout(() => {
      abort(new Error(message));
      if (res.headersSent) {
        return;
      }

      res.status(408).json({
        error: message,
        timeout: ms,
        path: req.path,
      });
    }, ms);

    const clearTimer = () => {
      clearTimeout(timer);
      req.off('aborted', onRequestAbort);
    };
    const onRequestAbort = () => abort(new Error('Client disconnected'));
    req.once('aborted', onRequestAbort);
    res.on('finish', clearTimer);
    res.on('close', () => {
      if (!res.writableEnded) abort(new Error('Client disconnected'));
      clearTimer();
    });

    next();
  };
};

// Reusable request timeouts for the surviving API surface.
export const defaultTimeout = requestTimeout({ ms: 60000 });
export const fastTimeout = requestTimeout({ ms: 10000 });
