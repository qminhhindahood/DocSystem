import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '..', '..');

describe('repository release integrity', () => {
  it('tracks application template source directories while ignoring only root template artifacts', () => {
    const frontendTemplate = 'frontend/components/templates/TemplateMappingReview.tsx';
    const ignoredSource = spawnSync('git', ['check-ignore', '-q', frontendTemplate], {
      cwd: repoRoot,
    });
    expect(ignoredSource.status).toBe(1);

    const ignoredRootArtifacts = spawnSync('git', ['check-ignore', '-q', 'templates/example.docx'], {
      cwd: repoRoot,
    });
    expect(ignoredRootArtifacts.status).toBe(0);
  });

  it('validates Prisma schema coverage from migration history without requiring init.sql', () => {
    const output = execFileSync(process.execPath, ['scripts/check_schema_sync.js'], {
      cwd: path.join(repoRoot, 'backend'),
      encoding: 'utf8',
    });
    expect(output).toContain('migration history');
  });
});
