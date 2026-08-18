import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { fastTimeout } from './middleware/timeout';
import { errorHandler } from './middleware/errorHandler';
import { generateLimiter, streamLimiter, searchLimiter, qaLimiter } from './middleware/ratelimit';
import ragRoutes from './routes/rag';
import workflowRoutes from './routes/workflow';
import feedbackRoutes from './routes/feedback';
import documentsRoutes from './routes/documents';
import authRoutes from './routes/auth';
import qaRoutes from './routes/qa';
import llmSettingsRoutes from './routes/llm-settings';
import templateRoutes from './routes/templates';
import documentProfileRoutes from './routes/document-profile';
import convertRoutes from './routes/convert';
import { prisma, disconnectPrisma } from './utils/prisma';
import { redisClient } from './utils/redis';
import { validateEnv } from './utils/validateEnv';
import type { Server } from 'http';
import { requestIdMiddleware } from './middleware/requestId';
import { requestLoggingMiddleware } from './middleware/request_logging';
import {
  createDefaultIngestionWorker,
  type IngestionWorker,
} from './services/ingestion_worker';
import {
  createDefaultTemplateCompilationWorker,
  type TemplateCompilationWorker,
} from './services/template_compilation_worker';
import { checkReadiness } from './services/readiness_service';
import { createShutdownHandler } from './utils/graceful_shutdown';
import { logger } from './utils/logger';

validateEnv();

const app = express();
export { app };
const PORT = process.env.PORT || 3001;
let ingestionWorker: IngestionWorker | null = null;
let templateCompilationWorker: TemplateCompilationWorker | null = null;
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
app.use('/api/', rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
}));
app.use((req, res, next) => {
  const longRunningPaths = new Set([
    '/api/workflow/extract-fields', '/api/workflow/generate',
    '/api/workflow/stream', '/api/qa/ask', '/api/convert',
  ]);
  if (longRunningPaths.has(req.path)) return next();
  return fastTimeout(req, res, next);
});

async function healthHandler(_req: express.Request, res: express.Response) {
  const health = await checkReadiness({
    workerStates: () => ({
      ingestion: ingestionWorker?.state ?? 'stopped',
      templates: templateCompilationWorker?.state ?? 'stopped',
    }),
  });
  res.status(health.status === 'ok' ? 200 : 503).json(health);
}

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);
app.get('/ready', healthHandler);
app.get('/live', (_req, res) => res.json({ status: 'alive' }));

// API root
app.get('/api', (req, res) => {
  res.json({
    name: 'AI Document System API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      workflow: {
        base: '/api/workflow',
        generate: '/api/workflow/generate (POST)',
        stream: '/api/workflow/stream (POST)',
        validate: '/api/workflow/validate (POST)',
        types: '/api/workflow/types (GET)',
        template: '/api/workflow/template/:documentType (GET)',
      },
      rag: '/api/rag',
      feedback: '/api/feedback',
      templates: '/api/templates',
    },
  });
});

// Rate limiting for expensive endpoints
app.use('/api/workflow/generate', generateLimiter);
app.use('/api/workflow/stream', streamLimiter);
app.use('/api/rag/search', searchLimiter);
app.use('/api/qa/ask', qaLimiter);

app.use('/api/rag', ragRoutes);
app.use('/api/workflow', workflowRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/documents', documentsRoutes);
app.use('/api/qa', qaRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/settings/llm', llmSettingsRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/settings/document-profile', documentProfileRoutes);
app.use('/api/convert', convertRoutes);

app.use(errorHandler);

async function startServer() {
  try {
    await redisClient.initialize();
    logger.info('Redis initialized');
  } catch (error) {
    logger.warn({ error }, 'Redis initialization failed; continuing in degraded mode');
  }

  // Check pgvector extension
  try {
    const result = await prisma.$queryRaw<{ extname: string }[]>`SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    if (result.length === 0) logger.warn('pgvector extension is unavailable; vector search is disabled');
    else logger.info('pgvector extension is available');
  } catch (error) {
    logger.warn({ error }, 'Unable to verify pgvector extension');
  }

  // Ensure HNSW index exists (idempotent, non-fatal)
  try {
    await prisma.$executeRawUnsafe('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chunks_embedding_hnsw ON "Chunk" USING hnsw (embedding vector_cosine_ops)');
    logger.info('HNSW index verified');
  } catch (error: any) {
    if (error.message?.includes('already exists')) logger.info('HNSW index already exists');
    else logger.warn({ error }, 'Unable to verify HNSW index');
  }

  // Ensure composite index on Chunk(documentId, level) for RAG query performance
  try {
    await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Chunk_documentId_level_idx" ON "Chunk"("documentId", "level")');
    logger.info('Chunk composite index verified');
  } catch (error: any) {
    logger.warn({ error }, 'Unable to verify chunk composite index');
  }

  httpServer = await listenForReady();
  logger.info({ port: Number(PORT) }, 'Backend server is listening');

  ingestionWorker = createDefaultIngestionWorker();
  ingestionWorker.start();
  templateCompilationWorker = createDefaultTemplateCompilationWorker();
  templateCompilationWorker.start();
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
  stopWorkers: async () => {
    await Promise.all([
      ingestionWorker?.stop(shutdownGraceMs),
      templateCompilationWorker?.stop(shutdownGraceMs),
    ]);
  },
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
