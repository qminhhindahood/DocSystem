'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { InlineAlert } from '@/components/ui/inline-alert';
import {
  getLLMSettings,
  saveLLMSettings,
  testLLMSettings,
  deleteLLMSettings,
  LLMConfigInput,
  AuthError,
} from '@/lib/settings-api';
import {
  LLM_PROVIDER_OPTIONS,
  LLM_PROVIDER_PRESETS,
  isCloudLLMProvider,
  llmModelPlaceholder,
  type LLMProvider,
} from '@/lib/llm-providers';

export function LLMSettingsForm() {
  const auth = useAuth();
  const abortRef = React.useRef<AbortController | null>(null);

  const [provider, setProvider] = useState<LLMProvider>('openrouter');
  const [baseUrl, setBaseUrl] = useState(LLM_PROVIDER_PRESETS.openrouter);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; model?: string; error?: string } | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    try {
      const data = await getLLMSettings(ctrl.signal);
      if (data.config) {
        setProvider(data.config.provider);
        setBaseUrl(data.config.baseUrl);
        setModel(data.config.model);
        setHasApiKey(Boolean(data.config.hasApiKey));
      }
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      if (err instanceof DOMException) return; // aborted
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => { load(); return () => abortRef.current?.abort(); }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSaving(true);
    setSaveStatus('idle');
    setError(null);
    try {
      const input: LLMConfigInput = {
        provider: provider as LLMConfigInput['provider'],
        baseUrl,
        model,
        apiKey: apiKey || undefined,
      };
      const result = await saveLLMSettings(input, ctrl.signal);
      setHasApiKey(Boolean(input.apiKey) || result.config.hasApiKey);
      setSaveStatus('saved');
      setApiKey(''); // clear write-only field after save
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      if (err instanceof DOMException) return;
      setSaveStatus('error');
      setError(err instanceof Error ? err.message : 'Không thể lưu cấu hình');
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      const input: LLMConfigInput = {
        provider: provider as LLMConfigInput['provider'],
        baseUrl,
        model,
        apiKey: apiKey || undefined,
      };
      const result = await testLLMSettings(input, ctrl.signal);
      setTestResult({ ok: result.success, model: result.model, error: result.error });
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      if (err instanceof DOMException) return;
      setTestResult({ ok: false, error: err instanceof Error ? err.message : 'Không thể kiểm tra kết nối' });
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    abortRef.current?.abort();
    try {
      await deleteLLMSettings();
      setProvider('openrouter');
      setBaseUrl('https://openrouter.ai/api/v1');
      setModel('');
      setApiKey('');
      setHasApiKey(false);
      setDeleteConfirm(false);
      setSaveStatus('idle');
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      setError(err instanceof Error ? err.message : 'Không thể xóa cấu hình');
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div
          role="status"
          aria-label="Đang tải cấu hình"
          className="h-6 w-6 animate-spin rounded-pill border-2 border-focus border-t-transparent"
        />
      </div>
    );
  }

  const busy = saving || testing;
  const cloud = isCloudLLMProvider(provider);

  function changeProvider(value: string) {
    const next = value as LLMProvider;
    setProvider(next);
    setBaseUrl(LLM_PROVIDER_PRESETS[next]);
    setApiKey('');
    setHasApiKey(false);
    setTestResult(null);
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      {/* One grouped section: these fields share a single responsibility. */}
      <div className="space-y-4 rounded-panel border border-hairline bg-surface p-4">
        <div>
          <h2 className="text-section-title text-text-primary">Nhà cung cấp LLM</h2>
          <p className="mt-1 text-metadata text-text-secondary">
            Cấu hình mô hình ngôn ngữ dùng khi tạo văn bản.
          </p>
        </div>

        {error && <InlineAlert variant="error">{error}</InlineAlert>}

        <Select
          label="Nhà cung cấp"
          value={provider}
          onValueChange={changeProvider}
          options={[...LLM_PROVIDER_OPTIONS]}
          disabled={busy}
        />

        <Input
          label="URL cơ sở"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={LLM_PROVIDER_PRESETS[provider] || 'https://llm.example.com/v1'}
          readOnly={cloud}
          helperText={cloud ? 'URL chính thức được DocAI quản lý tự động.' : undefined}
          disabled={busy}
          required
        />

        <Input
          label="Mô hình"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={llmModelPlaceholder(provider)}
          disabled={busy}
          required
        />

        <Input
          label="Khóa API"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={hasApiKey ? 'Để trống để giữ khóa đã lưu' : 'Nhập khóa API'}
          helperText="Khóa được mã hóa khi lưu và không hiển thị lại."
          required={cloud && !hasApiKey}
          disabled={busy}
          autoComplete="off"
        />

        {testResult && (
          <InlineAlert variant={testResult.ok ? 'success' : 'error'}>
            {testResult.ok
              ? `Kết nối thành công${testResult.model ? ` — ${testResult.model}` : ''}`
              : `Kết nối thất bại: ${testResult.error || 'Không rõ nguyên nhân'}`}
          </InlineAlert>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* One primary save action per form. */}
        <Button type="submit" size="lg" isLoading={saving} disabled={busy}>
          {saveStatus === 'saved' ? 'Đã lưu' : 'Lưu cấu hình'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          isLoading={testing}
          disabled={busy}
          onClick={handleTest}
        >
          Kiểm tra kết nối
        </Button>
        {deleteConfirm ? (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-metadata text-text-secondary">Xóa cấu hình đã lưu?</span>
            <Button type="button" variant="destructive" size="sm" onClick={handleDelete}>
              Xác nhận xóa
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => setDeleteConfirm(false)}>
              Hủy
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto text-error"
            disabled={busy}
            onClick={() => setDeleteConfirm(true)}
          >
            Xóa cấu hình
          </Button>
        )}
      </div>
    </form>
  );
}
