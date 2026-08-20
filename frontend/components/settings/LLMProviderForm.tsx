'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useAuth } from '@/components/auth/AuthProvider';
import { AuthError, getLLMSettings, saveLLMSettings, testLLMSettings, type LLMConfigInput } from '@/lib/settings-api';
import {
  LLM_PROVIDER_OPTIONS,
  LLM_PROVIDER_PRESETS,
  llmModelPlaceholder,
} from '@/lib/llm-providers';
import { OpenRouterModelPicker } from './OpenRouterModelPicker';

export function LLMProviderForm({ onSaved, onDirtyChange }: { onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const auth = useAuth();
  const refreshRef = useRef(auth.refresh);
  useEffect(() => { refreshRef.current = auth.refresh; }, [auth.refresh]);
  const [provider, setProvider] = useState<LLMConfigInput['provider']>('gemini');
  const [baseUrl, setBaseUrl] = useState(LLM_PROVIDER_PRESETS.gemini);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const baseline = useRef('');
  const snapshot = useMemo(() => JSON.stringify({ provider, baseUrl, model, apiKey }), [provider, baseUrl, model, apiKey]);

  useEffect(() => { onDirtyChange?.(!loading && !loadError && baseline.current !== snapshot); }, [loadError, loading, onDirtyChange, snapshot]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(false);
    getLLMSettings(controller.signal).then(({ config }) => {
      const next = config ? { provider: config.provider, baseUrl: config.baseUrl, model: config.model } : { provider: 'gemini' as const, baseUrl: LLM_PROVIDER_PRESETS.gemini, model: '' };
      setProvider(next.provider); setBaseUrl(next.baseUrl); setModel(next.model); setHasApiKey(Boolean(config?.hasApiKey));
      baseline.current = JSON.stringify({ ...next, apiKey: '' });
    }).catch((error) => {
      if (error instanceof AuthError) refreshRef.current();
      else if (!(error instanceof DOMException && error.name === 'AbortError')) setLoadError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadVersion]);

  function changeProvider(value: string) {
    const next = value as LLMConfigInput['provider'];
    setProvider(next); setBaseUrl(LLM_PROVIDER_PRESETS[next]); setApiKey(''); setHasApiKey(false); setMessage(null); onDirtyChange?.(true);
  }

  async function submit(kind: 'save' | 'test') {
    setBusy(kind); setMessage(null);
    const input = { provider, baseUrl, model, apiKey: apiKey || undefined };
    try {
      if (kind === 'test') {
        const result = await testLLMSettings(input);
        setMessage({ ok: result.success, text: result.success ? `Kết nối thành công${result.model ? ` — ${result.model}` : ''}` : `Kết nối thất bại: ${result.error || 'Không rõ nguyên nhân'}` });
      } else {
        const result = await saveLLMSettings(input);
        setHasApiKey(result.config.hasApiKey); setApiKey('');
        baseline.current = JSON.stringify({ provider, baseUrl, model, apiKey: '' }); onDirtyChange?.(false); onSaved?.();
      }
    } catch (error) {
      if (error instanceof AuthError) refreshRef.current();
      else setMessage({ ok: false, text: error instanceof Error ? error.message : 'Không thể hoàn tất yêu cầu' });
    } finally { setBusy(null); }
  }

  if (loading) return <p role="status" className="py-10 text-center text-control text-text-muted">Đang tải cấu hình…</p>;
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void submit('save'); }}>
    {loadError && <div role="alert" className="rounded-compact border border-error/30 px-3 py-2 text-control text-error">Không thể tải cấu hình khóa API. <Button type="button" variant="ghost" size="sm" onClick={() => setLoadVersion((value) => value + 1)}>Thử lại</Button></div>}
    <Select label="Nhà cung cấp" value={provider} onValueChange={changeProvider} options={[...LLM_PROVIDER_OPTIONS]} disabled={Boolean(busy) || loadError} />
    <Input label="URL cơ sở" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); onDirtyChange?.(true); }} readOnly disabled={Boolean(busy) || loadError} required />
    <p className="-mt-3 text-metadata text-text-muted">URL chính thức được DocAI quản lý tự động.</p>
    {provider === 'openrouter' ? <OpenRouterModelPicker
      value={model}
      onValueChange={(value) => { setModel(value); onDirtyChange?.(true); }}
      disabled={Boolean(busy) || loadError}
    /> : <Input label="Mô hình" value={model} onChange={(event) => { setModel(event.target.value); onDirtyChange?.(true); }} placeholder={llmModelPlaceholder(provider)} disabled={Boolean(busy) || loadError} required />}
    <Input label="Khóa API" type="password" value={apiKey} onChange={(event) => { setApiKey(event.target.value); onDirtyChange?.(true); }} placeholder={hasApiKey ? 'Để trống để giữ khóa đã lưu' : 'Nhập khóa API'} required={!hasApiKey} disabled={Boolean(busy) || loadError} autoComplete="off" />
    {message && <div role={message.ok ? 'status' : 'alert'} className={`rounded-compact border px-3 py-2 text-control ${message.ok ? 'border-success/30 text-success' : 'border-error/30 text-error'}`}>{message.text}</div>}
    <div className="flex flex-wrap justify-end gap-2 pt-2">
      <Button type="button" variant="secondary" isLoading={busy === 'test'} disabled={loadError} onClick={() => void submit('test')}>Kiểm tra kết nối</Button>
      <Button type="submit" isLoading={busy === 'save'} disabled={loadError}>Lưu cấu hình</Button>
    </div>
  </form>;
}
