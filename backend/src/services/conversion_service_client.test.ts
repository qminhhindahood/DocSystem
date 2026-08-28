import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import {
  assertUploadBatch,
  getSubmissionTimeoutMs,
  submitBulkConversion,
  submitConversion,
  type UploadLimits,
} from './conversion_service_client';

jest.mock('axios', () => ({
  __esModule: true,
  default: {
    post: jest.fn(),
    get: jest.fn(),
  },
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('conversion service multipart transport', () => {
  let tempDirectory: string;
  let pdfPath: string;

  beforeEach(() => {
    jest.clearAllMocks();
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'conversion-client-'));
    pdfPath = path.join(tempDirectory, 'source.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\nstreamed-content');
    mockedAxios.post.mockResolvedValue({ data: { jobId: 'job-1', mode: 'queue' } });
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it.each([
    [undefined, 300_000],
    ['', 300_000],
    ['450000', 450_000],
    ['900000', 600_000],
    ['999', 1_000],
    ['not-a-number', 300_000],
  ])('normalizes submission timeout %s to %d milliseconds', (raw, expected) => {
    expect(getSubmissionTimeoutMs(raw)).toBe(expected);
  });

  it('submits a file as a Node multipart stream without reading it into a Buffer', async () => {
    const readFile = jest.spyOn(fs.promises, 'readFile');

    await submitConversion(pdfPath, 'document.pdf', 'user-1');

    expect(readFile).not.toHaveBeenCalled();
    const [, body, config] = mockedAxios.post.mock.calls[0];
    expect(typeof (body as { pipe?: unknown }).pipe).toBe('function');
    expect(config).toMatchObject({
      timeout: 300_000,
      headers: {
        'X-User-Id': 'user-1',
        'content-type': expect.stringMatching(/^multipart\/form-data; boundary=/),
      },
    });
    readFile.mockRestore();
  });

  it('rejects more than ten bulk files before opening transport', async () => {
    const files = Array.from({ length: 11 }, (_, index) => ({ path: pdfPath, name: `${index}.pdf` }));

    await expect(submitBulkConversion(files, 'user-1')).rejects.toThrow('at most 10 files');

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('enforces individual and aggregate limits from file metadata', () => {
    const oneMegabyte = 1024 * 1024;
    const limits: UploadLimits = {
      maxFiles: 10,
      maxFileBytes: 60 * oneMegabyte,
      maxTotalBytes: 500 * oneMegabyte,
    };

    expect(() => assertUploadBatch([61 * oneMegabyte], limits)).toThrow('exceeds 60 MB');
    expect(() => assertUploadBatch(Array(9).fill(56 * oneMegabyte), limits)).toThrow('exceeds 500 MB');
    expect(() => assertUploadBatch(Array(10).fill(50 * oneMegabyte), limits)).not.toThrow();
  });
});
