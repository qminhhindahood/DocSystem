import { existsSync, readFileSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

// Override TEMPLATE_STORAGE_DIR before importing the module under test
const TEST_STORAGE_DIR = join(tmpdir(), `tmpl-test-${Date.now()}`);
process.env.TEMPLATE_STORAGE_DIR = TEST_STORAGE_DIR;
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://skip:skip@localhost:5432/skip';

const mockCreate = jest.fn();
jest.mock('../utils/prisma', () => ({
  prisma: { template: { create: (...args: any[]) => mockCreate(...args) } },
}));

import {
  uploadTemplate,
  sha256Of,
  getTemplatePath,
  deleteTemplateFile,
  readVerifiedGeneratedDocument,
  stageTemplateFileDeletion,
  stageGeneratedDocumentDeletion,
} from './template_storage_service';

async function makeDocx(relationship?: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
  if (relationship) zip.file('word/_rels/document.xml.rels', relationship);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

describe('template_storage_service', () => {
  afterEach(() => {
    jest.clearAllMocks();
    // Clean up test files
    try {
      const dir = `${TEST_STORAGE_DIR}/originals/user-a`;
      rmSync(dir, { recursive: true, force: true });
    } catch { /* ignore */ }
    try { rmSync(join(TEST_STORAGE_DIR, 'generated'), { recursive: true, force: true }); } catch { /* ignore */ }
  });

  describe('sha256Of', () => {
    it('computes SHA-256 hex digest', () => {
      const result = sha256Of(Buffer.from('hello'));
      expect(result).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    });
  });

  describe('uploadTemplate', () => {
    it('rejects files over 20 MiB', async () => {
      const big = Buffer.alloc(21 * 1024 * 1024);
      await expect(uploadTemplate('user-a', 'big', big)).rejects.toThrow(/exceeds maximum/);
    });

    it('creates a DB record and returns id + sha256', async () => {
      mockCreate.mockResolvedValueOnce({ id: 'mock-id' });
      const buffer = await makeDocx();

      // Mock uuid to be deterministic
      const result = await uploadTemplate('user-a', 'Test', buffer);

      expect(result.id).toBeDefined();
      expect(result.sha256).toBe(sha256Of(buffer));
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          ownerId: 'user-a',
          name: 'Test',
          status: 'UPLOADED',
          originalSha256: result.sha256,
          fileSize: buffer.length,
        }),
      }));
    });

    it('writes file to disk at the expected path', async () => {
      mockCreate.mockResolvedValueOnce({ id: 'disk-id' });
      const buffer = await makeDocx();

      const result = await uploadTemplate('user-a', 'Disk Test', buffer);
      const expectedPath = `${TEST_STORAGE_DIR}/originals/user-a/${result.id}.docx`;

      expect(existsSync(expectedPath)).toBe(true);
      expect(readFileSync(expectedPath)).toEqual(buffer);
    });

    it('rejects non-DOCX and external-relationship packages before persistence', async () => {
      await expect(uploadTemplate('user-a', 'Fake', Buffer.from('not-docx'))).rejects.toMatchObject({ statusCode: 400 });
      const external = await makeDocx('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid" TargetMode="External"/></Relationships>');
      await expect(uploadTemplate('user-a', 'External', external)).rejects.toThrow(/external relationship/i);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('removes the immutable original when the database create fails', async () => {
      mockCreate.mockRejectedValueOnce(new Error('database unavailable'));
      await expect(uploadTemplate('user-a', 'Failure', await makeDocx())).rejects.toThrow('database unavailable');
      const originals = join(TEST_STORAGE_DIR, 'originals', 'user-a');
      const remaining = existsSync(originals) ? readdirSync(originals) : [];
      expect(remaining.filter((name: string) => name.includes('.docx'))).toEqual([]);
    });
  });

  describe('getTemplatePath', () => {
    it('throws 404 for missing file', () => {
      expect(() => getTemplatePath('user-a', 'nonexistent')).toThrow(/Template file not found/);
    });
  });

  describe('deleteTemplateFile', () => {
    it('returns false for missing file', () => {
      expect(deleteTemplateFile('user-a', 'nonexistent')).toBe(false);
    });

    it('can restore a staged deletion when the database operation fails', async () => {
      mockCreate.mockResolvedValueOnce({});
      const uploaded = await uploadTemplate('user-a', 'Rollback', await makeDocx());
      const original = getTemplatePath('user-a', uploaded.id);
      const staged = stageTemplateFileDeletion('user-a', uploaded.id);
      expect(existsSync(original)).toBe(false);
      staged.rollback();
      expect(existsSync(original)).toBe(true);
    });
  });

  describe('readVerifiedGeneratedDocument', () => {
    it('accepts only the exact owner/document path and verifies its hash', () => {
      const buffer = Buffer.from('verified-docx');
      const dir = join(TEST_STORAGE_DIR, 'generated', 'user-a');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'doc-a.docx'), buffer);

      expect(readVerifiedGeneratedDocument(
        'user-a', 'doc-a', 'generated/user-a/doc-a.docx', sha256Of(buffer),
      )).toEqual(buffer);
      expect(() => readVerifiedGeneratedDocument(
        'user-a', 'doc-a', '../doc-a.docx', sha256Of(buffer),
      )).toThrow(/storage key/i);
      expect(() => readVerifiedGeneratedDocument(
        'user-a', 'doc-a', 'generated/user-a/doc-a.docx', '0'.repeat(64),
      )).toThrow(/hash/i);
    });

    it('stages only the exact owned generated document and supports commit or rollback', () => {
      const dir = join(TEST_STORAGE_DIR, 'generated', 'user-a');
      const path = join(dir, 'doc-a.docx');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, Buffer.from('generated'));

      const wrongOwner = stageGeneratedDocumentDeletion(
        'user-b', 'doc-a', 'generated/user-a/doc-a.docx',
      );
      wrongOwner.commit();
      expect(existsSync(path)).toBe(true);

      const rollback = stageGeneratedDocumentDeletion(
        'user-a', 'doc-a', 'generated/user-a/doc-a.docx',
      );
      expect(existsSync(path)).toBe(false);
      rollback.rollback();
      expect(existsSync(path)).toBe(true);

      const commit = stageGeneratedDocumentDeletion(
        'user-a', 'doc-a', 'generated/user-a/doc-a.docx',
      );
      commit.commit();
      expect(existsSync(path)).toBe(false);
    });
  });
});
