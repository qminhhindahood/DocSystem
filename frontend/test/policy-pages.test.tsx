import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PrivacyPage from '@/app/privacy/page';
import TermsPage from '@/app/terms/page';
import DataHandlingPage from '@/app/data-handling/page';

describe('public policy pages', () => {
  beforeEach(() => {
    vi.stubEnv('PUBLIC_OPERATOR_NAME', 'DocAI');
    vi.stubEnv('PUBLIC_OPERATOR_JURISDICTION', 'Vietnam');
    vi.stubEnv('PUBLIC_SUPPORT_EMAIL', 'support@docai.example.vn');
    vi.stubEnv('PUBLIC_POLICY_EFFECTIVE_DATE', '2026-08-31');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes privacy ownership, deletion, backup expiry, and support contact', () => {
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain('DocAI');
    expect(html).toContain('Vietnam');
    expect(html).toContain('support@docai.example.vn');
    expect(html).toContain('2026-08-31');
    expect(html).toMatch(/xóa tài khoản/i);
    expect(html).toMatch(/30 ngày/i);
  });

  it('states that converted output must be reviewed and carries no legal guarantee', () => {
    const html = renderToStaticMarkup(<TermsPage />);
    expect(html).toMatch(/không bảo đảm/i);
    expect(html).toMatch(/kiểm tra.*kết quả/i);
  });

  it('explains encrypted BYOK keys, temporary files, Turnstile, and backups', () => {
    const html = renderToStaticMarkup(<DataHandlingPage />);
    expect(html).toMatch(/khóa API.*mã hóa/i);
    expect(html).toMatch(/tệp nguồn.*tạm thời/i);
    expect(html).toMatch(/Turnstile/i);
    expect(html).toMatch(/bản sao lưu.*mã hóa/i);
  });
});
