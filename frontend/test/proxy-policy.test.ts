import { describe, expect, it } from 'vitest';
import { proxyRequestStatus } from '@/app/api/proxy/[...path]/route';

describe('BFF proxy policy', () => {
  it('allows conversion upload, status polling, report, and result download', () => {
    expect(proxyRequestStatus('convert', 'POST')).toBe(200);
    expect(proxyRequestStatus('convert/bulk', 'POST')).toBe(200);
    expect(proxyRequestStatus('convert/job-1', 'GET')).toBe(200);
    expect(proxyRequestStatus('convert/job-1/report', 'GET')).toBe(200);
    expect(proxyRequestStatus('convert/job-1/result', 'GET')).toBe(200);
  });

  it('rejects unsupported conversion methods', () => {
    expect(proxyRequestStatus('convert', 'GET')).toBe(405);
    expect(proxyRequestStatus('convert/job-1', 'DELETE')).toBe(405);
    expect(proxyRequestStatus('convert/job-1/result', 'POST')).toBe(405);
  });

  it('allows the BYOK LLM settings surface', () => {
    expect(proxyRequestStatus('settings/llm', 'GET')).toBe(200);
    expect(proxyRequestStatus('settings/llm', 'POST')).toBe(200);
    expect(proxyRequestStatus('settings/llm', 'DELETE')).toBe(200);
    expect(proxyRequestStatus('settings/llm/test', 'POST')).toBe(200);
    expect(proxyRequestStatus('settings/llm/openrouter/models', 'GET')).toBe(404);
  });

  it('rejects unsupported settings methods', () => {
    expect(proxyRequestStatus('settings/llm/test', 'GET')).toBe(405);
    expect(proxyRequestStatus('settings/llm/openrouter/models', 'POST')).toBe(404);
  });

  it('rejects every removed master-stack surface', () => {
    for (const dead of [
      'workflow/types', 'workflow/generate', 'qa/ask', 'rag/index',
      'feedback/submit', 'documents', 'documents/doc-a', 'templates',
      'settings/document-profile',
    ]) {
      expect(proxyRequestStatus(dead, 'GET')).toBe(404);
      expect(proxyRequestStatus(dead, 'POST')).toBe(404);
    }
  });
});
