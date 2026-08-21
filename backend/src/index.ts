import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { fastTimeout } from './middleware/timeout';
import {
  conversionStatusLimiter,
  generalApiLimiter,
} from './middleware/conversion_status_limiter';
import { errorHandler } from './middleware/errorHandler';
import authRoutes from './routes/auth';
import convertRoutes from './routes/convert';
import llmSettingsRoutes from './routes/llm-settings';
import { prisma, disconnectPrisma } from './utils/prisma';
import { redisClient } from './utils/redis';
import { validateEnv } from './utils/validateEnv';
import type { Server } from 'http';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLoggingMiddleware } from './middleware/request_logging';
import { checkReadiness } from './services/readiness_service';
import { createShutdownHandler } from './utils/graceful_shutdown';
import { logger } from './utils/logger';

validateEnv();

const app = express();
export { app };
const PORT = process.env.PORT || 3001;
let httpServer: Server | null = null;

function listenForReady(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(PORT);
    const onError = (error: Error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server);
    };
    server.once('error', onError);
    server.once('listening', onListening);
  });
}

// Middleware
const CORS_ORIGIN = process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ['http://localhost:3000'];
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS);
app.set('trust proxy', Number.isFinite(configuredProxyHops) ? Math.max(0, configuredProxyHops) : 0);
app.use('/api/', generalApiLimiter);
app.get('/api/convert/:jobId', conversionStatusLimiter);
app.use((req, res, next) => {
  const longRunningPaths = new Set([
    '/api/convert',
  ]);
  if (longRunningPaths.has(req.path)) return next();
  return fastTimeout(req, res, next);
});

async function healthHandler(_req: express.Request, res: express.Response) {
  const health = await checkReadiness({});
  res.status(health.status === 'ok' ? 200 : 503).json(health);
}

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);
app.get('/ready', healthHandler);
app.get('/live', (_req, res) => res.json({ status: 'alive' }));

// API root
app.get('/api', (req, res) => {
  res.json({
    name: 'Conversion Service API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      auth: '/api/auth',
      convert: {
        base: '/api/convert',
        submit: '/api/convert (POST)',
        bulk: '/api/convert/bulk (POST)',
        status: '/api/convert/:jobId (GET)',
        report: '/api/convert/:jobId/report (GET)',
        result: '/api/convert/:jobId/result (GET)',
      },
    },
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/convert', convertRoutes);
app.use('/api/settings/llm', llmSettingsRoutes);

app.use(errorHandler);

async function startServer() {
  try {
    await redisClient.initialize();
    logger.info('Redis initialized');
  } catch (error) {
    logger.warn({ error }, 'Redis initialization failed; continuing in degraded mode');
  }

  httpServer = await listenForReady();
  logger.info({ port: Number(PORT) }, 'Backend server is listening');
}

if (process.env.NODE_ENV !== 'test') {
  void startServer().catch((error) => {
    logger.error({ error }, 'Backend startup failed');
    void shutdown(1);
  });
}

const shutdownGraceMs = Number(process.env.SHUTDOWN_GRACE_MS || 30_000);
export const shutdown = createShutdownHandler({
  getServer: () => httpServer,
  stopWorkers: async () => {},
  closeRedis: () => redisClient.close(),
  disconnectPrisma,
  graceMs: shutdownGraceMs,
});

// Graceful shutdown handlers
process.once('SIGTERM', () => { void shutdown(0); });
process.once('SIGINT', () => { void shutdown(0); });
process.once('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception; shutting down');
  void shutdown(1);
});
process.once('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection; shutting down');
  void shutdown(1);
});
