import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { open, mkdir, rename, unlink, readFile, stat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import JSZip from 'jszip';
import { prisma } from '../utils/prisma';

function getTemplateStorageDir(): string {
  return process.env.TEMPLATE_STORAGE_DIR || resolve(__dirname, '../../uploads/templates');
}
const MAX_UPLOAD_SIZE = 20 * 1024 * 1024;
const MAX_EXPANDED_SIZE = 100 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5_000;
const MAX_COMPRESSION_RATIO = 100;

async function ensureDir(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
}

/** Compute SHA-256 of a buffer. */
export function sha256Of(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

function rejectPackage(message: string): never {
  throw Object.assign(new Error(message), { statusCode: 400 });
}

/** Validate ZIP metadata before decompression, then inspect relationship XML. */
export async function validateDocxPackage(buffer: Buffer): Promise<void> {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) rejectPackage('File is not a DOCX package');
  const searchStart = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) rejectPackage('DOCX central directory is missing');
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (entryCount > MAX_ZIP_ENTRIES || centralOffset + centralSize > buffer.length) {
    rejectPackage('DOCX package limits exceeded');
  }

  const names = new Set<string>();
  let expandedSize = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      rejectPackage('DOCX central directory is invalid');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length || (flags & 1) !== 0) rejectPackage('Encrypted DOCX packages are not supported');
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8').replace(/\\/g, '/');
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name)
      || name.split('/').some(segment => segment === '..' || segment === '.')) {
      rejectPackage('DOCX package contains an unsafe path');
    }
    names.add(name.toLowerCase());
    expandedSize += uncompressedSize;
    if (expandedSize > MAX_EXPANDED_SIZE
      || (uncompressedSize > 0 && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO))) {
      rejectPackage('DOCX package limits exceeded');
    }
    cursor = end;
  }
  if (!names.has('[content_types].xml') || !names.has('word/document.xml')) rejectPackage('File is not a DOCX document');
  if ([...names].some(name => name.endsWith('vbaproject.bin')
    || name.includes('/activex/') || name.includes('/embeddings/'))) {
    rejectPackage('DOCX package contains executable or embedded content');
  }

  let zip: JSZip;
  try { zip = await JSZip.loadAsync(buffer, { checkCRC32: true }); }
  catch { rejectPackage('DOCX package is corrupt'); }
  const relationshipFiles = Object.values(zip.files).filter(file => file.name.toLowerCase().endsWith('.rels'));
  for (const file of relationshipFiles) {
    const xml = await file.async('string');
    if (/TargetMode\s*=\s*["']External["']/i.test(xml)
      || /relationships\/(?:oleObject|activeX|attachedTemplate|externalLink)/i.test(xml)) {
      rejectPackage('DOCX package contains an external relationship');
    }
  }
}

/** Upload a template: validate size, write to disk atomically, create DB record. */
export async function uploadTemplate(
  ownerId: string,
  name: string,
  buffer: Buffer,
  docType?: string,
): Promise<{ id: string; sha256: string }> {
  if (buffer.length > MAX_UPLOAD_SIZE) {
    throw Object.assign(new Error(`File size ${buffer.length} exceeds maximum`), { statusCode: 413 });
  }
  await validateDocxPackage(buffer);

  const sha256 = sha256Of(buffer);
  const id = randomUUID();
  const dir = resolve(getTemplateStorageDir(), 'originals', ownerId);
  const tmpPath = resolve(dir, `${id}.docx.tmp`);
  const finalPath = resolve(dir, `${id}.docx`);

  await ensureDir(tmpPath);

  try {
    const handle = await open(tmpPath, 'wx');
    try {
      await handle.writeFile(buffer);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, finalPath);

    await prisma.template.create({
      data: {
        id,
        ownerId,
        name,
        docType: docType ?? null,
        header: '',
        signatureBlock: '',
        status: 'UPLOADED',
        originalSha256: sha256,
        fileSize: buffer.length,
        originalPath: `originals/${ownerId}/${id}.docx`,
      },
    });

    return { id, sha256 };
  } catch (err) {
    // Cleanup temp file if DB or fs failed
    await unlink(tmpPath).catch(() => undefined);
    await unlink(finalPath).catch(() => undefined);
    throw err;
  }
}

/** Disk-backed upload entry point used by Multer to avoid buffering request bodies. */
export async function uploadTemplateFromPath(
  ownerId: string,
  name: string,
  sourcePath: string,
  docType?: string,
): Promise<{ id: string; sha256: string }> {
  const source = await stat(sourcePath);
  if (!source.isFile() || source.size > MAX_UPLOAD_SIZE) {
    throw Object.assign(new Error(`File size ${source.size} exceeds maximum`), { statusCode: 413 });
  }
  return uploadTemplate(ownerId, name, await readFile(sourcePath), docType);
}

/** Delete template file from disk. Returns true if file existed. */
export function deleteTemplateFile(ownerId: string, templateId: string): boolean {
  const path = resolve(getTemplateStorageDir(), 'originals', ownerId, `${templateId}.docx`);
  if (!existsSync(path)) return false;
  unlinkSync(path);
  return true;
}

export interface StagedTemplateDeletion {
  commit(): void;
  rollback(): void;
}

/** Move an original aside so a failed DB delete can restore it. */
export function stageTemplateFileDeletion(ownerId: string, templateId: string): StagedTemplateDeletion {
  const path = resolve(getTemplateStorageDir(), 'originals', ownerId, `${templateId}.docx`);
  if (!existsSync(path)) return { commit() {}, rollback() {} };
  const staged = `${path}.delete-${randomUUID()}`;
  renameSync(path, staged);
  return {
    commit: () => { if (existsSync(staged)) unlinkSync(staged); },
    rollback: () => { if (existsSync(staged) && !existsSync(path)) renameSync(staged, path); },
  };
}

/** Move an owned generated DOCX aside so a failed DB delete can restore it. */
export function stageGeneratedDocumentDeletion(
  ownerId: string,
  documentId: string,
  storageKey: string | null,
): StagedTemplateDeletion {
  const expectedKey = `generated/${ownerId}/${documentId}.docx`;
  if (storageKey !== expectedKey) return { commit() {}, rollback() {} };

  const generatedRoot = resolve(getTemplateStorageDir(), 'generated');
  const path = resolve(getTemplateStorageDir(), ...storageKey.split('/'));
  if (!path.startsWith(`${generatedRoot}${sep}`)) {
    throw Object.assign(new Error('Generated document path escapes storage root'), { statusCode: 409 });
  }
  if (!existsSync(path)) return { commit() {}, rollback() {} };

  const staged = `${path}.delete-${randomUUID()}`;
  renameSync(path, staged);
  return {
    commit: () => { if (existsSync(staged)) unlinkSync(staged); },
    rollback: () => { if (existsSync(staged) && !existsSync(path)) renameSync(staged, path); },
  };
}

/** Get the absolute path to a template's original file. */
export function getTemplatePath(ownerId: string, templateId: string): string {
  const path = resolve(getTemplateStorageDir(), 'originals', ownerId, `${templateId}.docx`);
  if (!existsSync(path)) throw Object.assign(new Error('Template file not found'), { statusCode: 404 });
  return path;
}

/** Read template file bytes. */
export function readTemplateFile(ownerId: string, templateId: string): Buffer {
  return readFileSync(getTemplatePath(ownerId, templateId));
}

/** Read only a preview path already stored for this template. */
export function readTemplatePreview(templateId: string, storedRelativePath: string): Buffer {
  const expectedPrefix = `previews/${templateId}/`;
  if (!storedRelativePath.startsWith(expectedPrefix) || storedRelativePath.includes('..')) {
    throw Object.assign(new Error('Invalid template preview path'), { statusCode: 409 });
  }
  const root = resolve(getTemplateStorageDir());
  const absolute = resolve(root, ...storedRelativePath.split('/'));
  if (!absolute.startsWith(`${root}${sep}`) || !existsSync(absolute)) {
    throw Object.assign(new Error('Template preview not found'), { statusCode: 404 });
  }
  return readFileSync(absolute);
}

/** Read an immutable generated DOCX only when path ownership and hash agree. */
export function readVerifiedGeneratedDocument(
  ownerId: string,
  documentId: string,
  storageKey: string,
  expectedSha256: string,
): Buffer {
  const expectedKey = `generated/${ownerId}/${documentId}.docx`;
  if (storageKey !== expectedKey) {
    throw Object.assign(new Error('Invalid generated document storage key'), { statusCode: 409 });
  }
  const generatedRoot = resolve(getTemplateStorageDir(), 'generated');
  const absolutePath = resolve(getTemplateStorageDir(), ...storageKey.split('/'));
  if (!absolutePath.startsWith(`${generatedRoot}${sep}`)) {
    throw Object.assign(new Error('Generated document path escapes storage root'), { statusCode: 409 });
  }
  if (!existsSync(absolutePath)) {
    throw Object.assign(new Error('Generated document file not found'), { statusCode: 404 });
  }
  const buffer = readFileSync(absolutePath);
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256) || sha256Of(buffer) !== expectedSha256.toLowerCase()) {
    throw Object.assign(new Error('Generated document hash verification failed'), { statusCode: 409 });
  }
  return buffer;
}
