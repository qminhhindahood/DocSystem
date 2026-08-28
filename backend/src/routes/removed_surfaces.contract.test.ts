/**
 * Contract tests asserting admin/reviewer/training/LoRA surfaces are absent.
 * These routes are permanently removed in Phase 1 Task 6.
 */
import fs from 'fs';
import path from 'path';

describe('removed runtime surfaces', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const srcRoot = path.resolve(__dirname, '..');

  it('admin_auth middleware file is deleted', () => {
    expect(fs.existsSync(path.join(srcRoot, 'middleware', 'admin_auth.ts'))).toBe(false);
  });

  it('admin routes directory is deleted', () => {
    expect(fs.existsSync(path.join(srcRoot, 'routes', 'admin'))).toBe(false);
  });

  it('feedback_rag_promotion service is deleted', () => {
    expect(fs.existsSync(path.join(srcRoot, 'services', 'feedback_rag_promotion.ts'))).toBe(false);
  });

  it('model_version_service is deleted', () => {
    expect(fs.existsSync(path.join(srcRoot, 'services', 'model_version_service.ts'))).toBe(false);
  });

  it('training_auto_check is deleted', () => {
    expect(fs.existsSync(path.join(srcRoot, 'services', 'training_auto_check.ts'))).toBe(false);
  });

  it('training_data_exporter is deleted', () => {
    expect(fs.existsSync(path.join(srcRoot, 'services', 'training_data_exporter.ts'))).toBe(false);
  });

  it('lora-service directory is deleted', () => {
    expect(fs.existsSync(path.join(repoRoot, 'lora-service', 'main.py'))).toBe(false);
  });

  it('no admin route imports remain in index.ts', () => {
    const indexSrc = fs.readFileSync(path.join(srcRoot, 'index.ts'), 'utf-8');
    expect(indexSrc).not.toContain('./routes/admin/');
    expect(indexSrc).not.toContain('./services/feedback_rag_promotion');
    expect(indexSrc).not.toContain('./services/model_version_service');
    expect(indexSrc).not.toContain('./services/training_auto_check');
    expect(indexSrc).not.toContain('./services/training_data_exporter');
  });

  it('lora references removed from docker-compose.yml', () => {
    const composeSrc = fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf-8');
    expect(composeSrc).not.toContain('lora-service');
    expect(composeSrc).not.toContain('LORA_SERVICE_URL');
  });

  it('lora env validation removed from validateEnv', () => {
    const validateSrc = fs.readFileSync(path.join(srcRoot, 'utils', 'validateEnv.ts'), 'utf-8');
    expect(validateSrc).not.toContain('LORA_SERVICE_URL');
  });

  it('index.ts no longer imports LORA_SERVICE_URL', () => {
    const indexSrc = fs.readFileSync(path.join(srcRoot, 'index.ts'), 'utf-8');
    expect(indexSrc).not.toContain('LORA_SERVICE_URL');
    expect(indexSrc).not.toContain('lora');
  });
});

describe('removed master-stack surfaces (standalone prune, ticket 04)', () => {
  const srcRoot = path.resolve(__dirname, '..');

  it.each([
    'qa', 'rag', 'workflow', 'templates', 'feedback',
    'documents', 'document-profile',
  ])('route %s is deleted', (name) => {
    expect(fs.existsSync(path.join(srcRoot, 'routes', `${name}.ts`))).toBe(false);
  });

  it('llm-settings route is present again (BYOK vision provider settings)', () => {
    expect(fs.existsSync(path.join(srcRoot, 'routes', 'llm-settings.ts'))).toBe(true);
  });

  it('OpenRouter catalog and provider services are deleted', () => {
    expect(fs.existsSync(path.join(srcRoot, 'services', 'openrouter_models.ts'))).toBe(false);
    expect(fs.existsSync(path.join(srcRoot, 'config', 'openrouter_models.ts'))).toBe(false);
  });

  it.each([
    'orchestrator', 'rag_service', 'query_rewriter', 'context_filter', 'context_packer',
    'retrieval_pipeline', 'retrieval_observability', 'self_correct', 'structured_output_service',
    'cmd_parser', 'docx_service', 'feedback_service', 'feedback_analysis',
    'ingestion_service', 'ingestion_worker', 'ingestion_job_repository',
    'document_profile_service',
    'template_service', 'template_compiler', 'template_generation_service',
    'template_semantics', 'template_typography_rules', 'template_vision_service',
    'template_service_client', 'template_storage_service', 'template_compilation_worker',
  ])('service %s is deleted', (name) => {
    expect(fs.existsSync(path.join(srcRoot, 'services', `${name}.ts`))).toBe(false);
  });

  it.each([
    'abort', 'cloud_run_auth', 'document_access', 'embeddings_client',
    'feedback_utils', 'sse_parser', 'sanitize',
  ])('util %s is deleted', (name) => {
    expect(fs.existsSync(path.join(srcRoot, 'utils', `${name}.ts`))).toBe(false);
  });

  it('encryption and urlGuard utils are present again (BYOK key storage)', () => {
    expect(fs.existsSync(path.join(srcRoot, 'utils', 'encryption.ts'))).toBe(true);
    expect(fs.existsSync(path.join(srcRoot, 'utils', 'urlGuard.ts'))).toBe(true);
  });

  it('index.ts mounts only auth, convert, and BYOK settings routes', () => {
    const indexSrc = fs.readFileSync(path.join(srcRoot, 'index.ts'), 'utf-8');
    expect(indexSrc).toContain("app.use('/api/auth', authRoutes)");
    expect(indexSrc).toContain("app.use('/api/convert', convertRoutes)");
    expect(indexSrc).toContain("app.use('/api/settings/llm', llmSettingsRoutes)");
    for (const dead of ['qaRoutes', 'ragRoutes', 'workflowRoutes', 'templateRoutes', 'feedbackRoutes', 'documentsRoutes', 'documentProfileRoutes']) {
      expect(indexSrc).not.toContain(dead);
    }
  });

  it('readiness probes only the standalone stack', () => {
    const readinessSrc = fs.readFileSync(path.join(srcRoot, 'services', 'readiness_service.ts'), 'utf-8');
    expect(readinessSrc).not.toContain('DOCLING_URL');
    expect(readinessSrc).not.toContain('EMBEDDINGS_URL');
    expect(readinessSrc).not.toContain('DOCUMENT_RENDERER_URL');
    expect(readinessSrc).toContain('conversionServiceHealthy');
  });

  it('shared resilience helpers expose no removed-service APIs', () => {
    const breakers = fs.readFileSync(path.join(srcRoot, 'utils', 'circuit_breaker.ts'), 'utf-8');
    const redis = fs.readFileSync(path.join(srcRoot, 'utils', 'redis.ts'), 'utf-8');
    const timeouts = fs.readFileSync(path.join(srcRoot, 'middleware', 'timeout.ts'), 'utf-8');

    for (const removed of ['lmStudioBreaker', 'doclingBreaker', 'embeddingsBreaker']) {
      expect(breakers).not.toContain(removed);
    }
    for (const removed of [
      'RedisState', 'initializeSession', 'getSession', 'updateSession',
      'setPlanningState', 'setResearchingState', 'setWritingState',
      'markComplete', 'markError', 'lPush', 'rPopLPush', 'setNx',
    ]) {
      expect(redis).not.toContain(removed);
    }
    expect(timeouts).not.toContain('generationTimeout');
    expect(timeouts).not.toContain('Document generation');
  });
});

describe('removed master-stack directories (standalone prune, ticket 08)', () => {
  const repoRoot = path.resolve(__dirname, '../../..');

  it.each([
    'docling-service', 'embeddings-service', 'document-renderer',
    'cloudflare-worker', 'infra', 'deploy', 'templates',
  ])('directory %s is deleted', (dir) => {
    expect(fs.existsSync(path.join(repoRoot, dir))).toBe(false);
  });

  it('add_header.py is deleted', () => {
    expect(fs.existsSync(path.join(repoRoot, 'add_header.py'))).toBe(false);
  });

  it('the production deploy workflow is deleted', () => {
    expect(fs.existsSync(path.join(repoRoot, '.github', 'workflows', 'deploy-production.yml'))).toBe(false);
  });

  it('CI keeps only the standalone product jobs', () => {
    const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf-8');
    for (const job of ['backend', 'frontend', 'conversion', 'containers', 'repository-contracts']) {
      expect(ci).toMatch(new RegExp(`^  ${job}:`, 'm'));
    }
    for (const dead of ['worker', 'renderer', 'python', 'terraform']) {
      expect(ci).not.toMatch(new RegExp(`^  ${dead}:`, 'm'));
    }
    for (const dead of ['- service: docling', '- service: embeddings', '- service: renderer']) {
      expect(ci).not.toContain(dead);
    }
  });
});
