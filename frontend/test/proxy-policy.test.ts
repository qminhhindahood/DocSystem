import { describe, expect, it } from 'vitest';
import { proxyRequestStatus } from '@/app/api/proxy/[...path]/route';

describe('BFF proxy policy', () => {
  it('allows authenticated smoke cleanup of an owned document', () => {
    expect(proxyRequestStatus('documents/doc-a', 'DELETE')).toBe(200);
  });

  it('allows conversion upload, status polling, and result download', () => {
    expect(proxyRequestStatus('convert', 'POST')).toBe(200);
    expect(proxyRequestStatus('convert/job-1', 'GET')).toBe(200);
    expect(proxyRequestStatus('convert/job-1/result', 'GET')).toBe(200);
  });

  it('rejects unsupported conversion methods', () => {
    expect(proxyRequestStatus('convert', 'GET')).toBe(405);
    expect(proxyRequestStatus('convert/job-1', 'DELETE')).toBe(405);
    expect(proxyRequestStatus('convert/job-1/result', 'POST')).toBe(405);
  });
});
