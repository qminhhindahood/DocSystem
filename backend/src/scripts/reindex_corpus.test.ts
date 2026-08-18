import { describe, expect, it } from '@jest/globals';
import path from 'path';
import { assertUniqueSourceInputs, parseArgs } from './reindex_corpus';

describe('reindex corpus CLI safety', () => {
  it('rejects no-argument invocation', () => {
    expect(() => parseArgs([])).toThrow('No action taken');
  });

  it('requires an explicit force flag', () => {
    expect(() => parseArgs(['--dir', 'pdfs', '--doctype', 'cong-van'])).toThrow('--force is required');
  });

  it('parses a deliberate forced run and report path', () => {
    const result = parseArgs([
      '--force', '--dir', 'pdfs', '--doctype', 'cong-van', '--report', 'report.json',
    ]);
    expect(result).toEqual({
      force: true,
      dir: path.resolve('pdfs'),
      files: [],
      doctype: 'cong-van',
      reportPath: path.resolve('report.json'),
    });
  });

  it('accepts repeated explicit PDF files without requiring a staging directory', () => {
    const result = parseArgs([
      '--force', '--file', 'one.pdf', '--file', 'two.pdf', '--doctype', 'cong-van',
    ]);
    expect(result.dir).toBeUndefined();
    expect(result.files).toEqual([path.resolve('one.pdf'), path.resolve('two.pdf')]);
  });

  it('rejects ambiguous directory and explicit-file source modes', () => {
    expect(() => parseArgs([
      '--force', '--dir', 'pdfs', '--file', 'one.pdf', '--doctype', 'cong-van',
    ])).toThrow('exactly one source mode');
  });

  it('rejects duplicate content and duplicate filenames before indexing', () => {
    expect(() => assertUniqueSourceInputs([
      { file: 'one.pdf', sha256: 'same' },
      { file: 'two.pdf', sha256: 'same' },
    ])).toThrow('Duplicate PDF content');
    expect(() => assertUniqueSourceInputs([
      { file: 'ONE.pdf', sha256: 'first' },
      { file: 'one.pdf', sha256: 'second' },
    ])).toThrow('Duplicate PDF filename');
  });

  it('rejects unknown options rather than silently ignoring them', () => {
    expect(() => parseArgs(['--force', '--dir', 'pdfs', '--doctype', 'cong-van', '--dryrun']))
      .toThrow('Unknown option');
  });
});
