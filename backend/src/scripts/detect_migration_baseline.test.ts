import {
  runBaselineDetector,
  type BaselineInspector,
  type DetectorIo,
} from './detect_migration_baseline';
import type { DatabaseShape } from '../services/migration_baseline';

function memoryIo(): DetectorIo & { stdoutText: string; stderrText: string } {
  const io = {
    stdoutText: '',
    stderrText: '',
    stdout: {
      write(text: string) {
        io.stdoutText += text;
      },
    },
    stderr: {
      write(text: string) {
        io.stderrText += text;
      },
    },
  };
  return io;
}

function inspectorFor(shape: DatabaseShape): BaselineInspector & { disconnect: jest.Mock } {
  return {
    inspect: jest.fn().mockResolvedValue(shape),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
}

describe('runBaselineDetector', () => {
  it('prints only a fresh state to stdout', async () => {
    const inspector = inspectorFor({
      tables: ['legacy_audit'],
      columns: [],
      keys: [],
      appliedMigrationNames: [],
    });
    const io = memoryIo();

    const exitCode = await runBaselineDetector(inspector, io);

    expect(exitCode).toBe(0);
    expect(io.stdoutText).toBe('fresh\n');
    expect(io.stderrText).toBe('');
    expect(inspector.disconnect).toHaveBeenCalledTimes(1);
  });

  it('fails closed with backup-safe diagnostics on a partial product schema', async () => {
    const inspector = inspectorFor({
      tables: ['User'],
      columns: [],
      keys: [],
      appliedMigrationNames: [],
    });
    const io = memoryIo();

    const exitCode = await runBaselineDetector(inspector, io);

    expect(exitCode).toBe(2);
    expect(io.stdoutText).toBe('');
    expect(io.stderrText).toContain('Existing database is not compatible with the standalone baseline.');
    expect(io.stderrText).toContain('Back up the database before changing its schema.');
    expect(io.stderrText).toContain('Missing required table "PasswordResetToken".');
    expect(inspector.disconnect).toHaveBeenCalledTimes(1);
  });

  it('reports inspection failures without leaking them into stdout', async () => {
    const inspector: BaselineInspector & { disconnect: jest.Mock } = {
      inspect: jest.fn().mockRejectedValue(new Error('connection refused')),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const io = memoryIo();

    const exitCode = await runBaselineDetector(inspector, io);

    expect(exitCode).toBe(1);
    expect(io.stdoutText).toBe('');
    expect(io.stderrText).toContain('Could not inspect the database migration baseline: connection refused');
    expect(inspector.disconnect).toHaveBeenCalledTimes(1);
  });
});
