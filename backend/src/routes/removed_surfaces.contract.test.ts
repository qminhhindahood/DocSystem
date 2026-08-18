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
