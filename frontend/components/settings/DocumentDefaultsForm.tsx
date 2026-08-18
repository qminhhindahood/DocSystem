'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AuthError, getDocumentProfile, saveDocumentProfile, type DocumentProfileInput } from '@/lib/settings-api';
import { useAuth } from '@/components/auth/AuthProvider';

const EMPTY = { supervisingAgency: '', agencyName: '', agencyCode: '', agencyAddress: '', agencyEmail: '', agencyWebsite: '', agencyPhone: '', defaultPlace: '', recipients: '', signatoryName: '', signatoryTitle: '', documentNumberPrefix: '' };

export function DocumentDefaultsForm({ onSaved, onDirtyChange }: { onSaved?: () => void; onDirtyChange?: (dirty: boolean) => void }) {
  const auth = useAuth();
  const refreshRef = useRef(auth.refresh);
  useEffect(() => { refreshRef.current = auth.refresh; }, [auth.refresh]);
  const [values, setValues] = useState(EMPTY);
  const [nextNumber, setNextNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const baseline = useRef('');
  const snapshot = useMemo(() => JSON.stringify(values), [values]);
  useEffect(() => { onDirtyChange?.(!loading && !loadFailed && baseline.current !== snapshot); }, [loadFailed, loading, onDirtyChange, snapshot]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadFailed(false); setError('');
    getDocumentProfile(controller.signal).then(({ profile }) => {
      const next = profile ? { supervisingAgency: profile.supervisingAgency || '', agencyName: profile.agencyName || '', agencyCode: profile.agencyCode || '', agencyAddress: profile.agencyAddress || '', agencyEmail: profile.agencyEmail || '', agencyWebsite: profile.agencyWebsite || '', agencyPhone: profile.agencyPhone || '', defaultPlace: profile.defaultPlace || '', recipients: (profile.defaultRecipients || []).join('\n'), signatoryName: profile.signatoryName || '', signatoryTitle: profile.signatoryTitle || '', documentNumberPrefix: profile.documentNumberPrefix || '' } : EMPTY;
      setValues(next); setNextNumber(profile?.nextDocumentNumber ?? null); baseline.current = JSON.stringify(next);
    }).catch((reason) => {
      if (reason instanceof AuthError) refreshRef.current();
      else if (!(reason instanceof DOMException && reason.name === 'AbortError')) { setLoadFailed(true); setError('Không thể tải thông tin mặc định.'); }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [loadVersion]);
  function field(name: keyof typeof EMPTY) { return { value: values[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { setValues((current) => ({ ...current, [name]: event.target.value })); onDirtyChange?.(true); } }; }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    const input: DocumentProfileInput = { supervisingAgency: values.supervisingAgency || null, agencyName: values.agencyName || null, agencyCode: values.agencyCode || null, agencyAddress: values.agencyAddress || null, agencyEmail: values.agencyEmail || null, agencyWebsite: values.agencyWebsite || null, agencyPhone: values.agencyPhone || null, defaultPlace: values.defaultPlace || null, defaultRecipients: values.recipients.split('\n').map((item) => item.trim()).filter(Boolean), signatoryName: values.signatoryName || null, signatoryTitle: values.signatoryTitle || null, documentNumberPrefix: values.documentNumberPrefix || null };
    try { await saveDocumentProfile(input); baseline.current = snapshot; onDirtyChange?.(false); onSaved?.(); }
    catch (reason) { if (reason instanceof AuthError) refreshRef.current(); else setError(reason instanceof Error ? reason.message : 'Không thể lưu thông tin mặc định.'); }
    finally { setSaving(false); }
  }
  if (loading) return <p role="status" className="py-10 text-center text-control text-text-muted">Đang tải thông tin mặc định…</p>;
  return <form onSubmit={save} className="space-y-4">
    {error && <div role="alert" className="rounded-compact border border-error/30 px-3 py-2 text-control text-error">{error}{loadFailed && <Button type="button" variant="ghost" size="sm" onClick={() => setLoadVersion((value) => value + 1)}>Thử lại</Button>}</div>}
    <Input label="Cơ quan chủ quản" {...field('supervisingAgency')} placeholder="Bộ Giáo dục và Đào tạo" />
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Tên cơ quan" {...field('agencyName')} placeholder="Cục/Vụ/đơn vị trực thuộc" /><Input label="Mã cơ quan" {...field('agencyCode')} placeholder="BGDĐT" /></div>
    <Input label="Địa chỉ cơ quan" {...field('agencyAddress')} placeholder="Số nhà, đường, phường/xã, tỉnh/thành phố" />
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Thư điện tử" type="email" {...field('agencyEmail')} placeholder="vanthu@moet.gov.vn" /><Input label="Số điện thoại" {...field('agencyPhone')} placeholder="024 ..." /></div>
    <Input label="Trang thông tin điện tử" type="url" {...field('agencyWebsite')} placeholder="https://moet.gov.vn" />
    <Input label="Địa danh mặc định" {...field('defaultPlace')} placeholder="Hà Nội" />
    <div><label htmlFor="default-recipients" className="mb-1.5 block text-metadata font-medium text-text-muted">Nơi nhận mặc định</label><textarea id="default-recipients" {...field('recipients')} rows={4} className="control-field w-full" placeholder="Mỗi nơi nhận trên một dòng" /><p className="mt-1 text-metadata text-text-muted">Nhập mỗi cơ quan hoặc cá nhân trên một dòng.</p></div>
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Người ký" {...field('signatoryName')} placeholder="Nguyễn Văn A" /><Input label="Chức vụ người ký" {...field('signatoryTitle')} placeholder="Chủ tịch" /></div>
    <div className="grid gap-4 sm:grid-cols-2"><Input label="Tiền tố số văn bản" {...field('documentNumberPrefix')} placeholder="QĐ-UBND" /><div><span className="mb-1.5 block text-metadata font-medium text-text-muted">Số văn bản tiếp theo</span><div className="control-field text-text-muted" aria-readonly="true">{nextNumber ?? '—'}</div><p className="mt-1 text-metadata text-text-muted">Số này do máy chủ quản lý.</p></div></div>
    <div className="flex justify-end pt-2"><Button type="submit" isLoading={saving} disabled={loadFailed}>Lưu thông tin mặc định</Button></div>
  </form>;
}
