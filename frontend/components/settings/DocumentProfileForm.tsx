'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  getDocumentProfile,
  saveDocumentProfile,
  DocumentProfile,
  AuthError,
} from '@/lib/settings-api';

export function DocumentProfileForm() {
  const auth = useAuth();
  const abortRef = React.useRef<AbortController | null>(null);

  const [profile, setProfile] = useState<DocumentProfile | null>(null);
  const [agencyName, setAgencyName] = useState('');
  const [agencyCode, setAgencyCode] = useState('');
  const [defaultPlace, setDefaultPlace] = useState('');
  const [recipientInput, setRecipientInput] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [signatoryName, setSignatoryName] = useState('');
  const [signatoryTitle, setSignatoryTitle] = useState('');
  const [documentNumberPrefix, setDocumentNumberPrefix] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    try {
      const data = await getDocumentProfile(ctrl.signal);
      if (data.profile) {
        setProfile(data.profile);
        setAgencyName(data.profile.agencyName || '');
        setAgencyCode(data.profile.agencyCode || '');
        setDefaultPlace(data.profile.defaultPlace || '');
        setRecipients(data.profile.defaultRecipients || []);
        setSignatoryName(data.profile.signatoryName || '');
        setSignatoryTitle(data.profile.signatoryTitle || '');
        setDocumentNumberPrefix(data.profile.documentNumberPrefix || '');
      }
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      if (err instanceof DOMException) return;
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => { load(); return () => abortRef.current?.abort(); }, [load]);

  function addRecipient() {
    const trimmed = recipientInput.trim();
    if (trimmed && !recipients.includes(trimmed)) {
      setRecipients([...recipients, trimmed]);
      setRecipientInput('');
    }
  }

  function removeRecipient(index: number) {
    setRecipients(recipients.filter((_, i) => i !== index));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setSaving(true);
    setSaveStatus('idle');
    setError(null);
    try {
      await saveDocumentProfile({
        agencyName: agencyName || null,
        agencyCode: agencyCode || null,
        defaultPlace: defaultPlace || null,
        defaultRecipients: recipients.length > 0 ? recipients : null,
        signatoryName: signatoryName || null,
        signatoryTitle: signatoryTitle || null,
        documentNumberPrefix: documentNumberPrefix || null,
      }, ctrl.signal);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      if (err instanceof DOMException) return;
      setSaveStatus('error');
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-focus border-t-transparent rounded-pill animate-spin" role="status" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div>
        <h2 className="text-section-title text-text-primary">Document Defaults</h2>
        <p className="text-metadata text-text-muted mt-0.5">
          Pre-fill values used when generating new documents
        </p>
      </div>

      {error && (
        <div className="rounded-compact bg-error-surface border border-error/30 px-4 py-3 text-control text-error" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Agency name"
          value={agencyName}
          onChange={(e) => setAgencyName(e.target.value)}
          placeholder="UBND thành phố Hà Nội"
          maxLength={200}
          disabled={saving}
        />
        <Input
          label="Agency code"
          value={agencyCode}
          onChange={(e) => setAgencyCode(e.target.value)}
          placeholder="UBND-HN"
          maxLength={50}
          disabled={saving}
        />
      </div>

      <Input
        label="Default place"
        value={defaultPlace}
        onChange={(e) => setDefaultPlace(e.target.value)}
        placeholder="Hà Nội"
        maxLength={200}
        disabled={saving}
      />

      {/* Recipients */}
      <div>
        <label htmlFor="default-recipient" className="block text-metadata font-medium text-text-muted mb-1.5">
          Default recipients
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {recipients.map((r, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill bg-action/10 text-action text-metadata font-medium"
            >
              {r}
              <button
                type="button"
                onClick={() => removeRecipient(i)}
                className="hover:text-error transition-colors"
                aria-label={`Remove ${r}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            id="default-recipient"
            type="text"
            value={recipientInput}
            onChange={(e) => setRecipientInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
            placeholder="Type a recipient and press Enter"
            maxLength={300}
            disabled={saving}
            className="control-field flex-1 text-control"
          />
          <Button type="button" variant="secondary" size="sm" onClick={addRecipient} disabled={!recipientInput.trim()}>
            Add
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Signatory name"
          value={signatoryName}
          onChange={(e) => setSignatoryName(e.target.value)}
          placeholder="Nguyễn Văn A"
          maxLength={200}
          disabled={saving}
        />
        <Input
          label="Signatory title"
          value={signatoryTitle}
          onChange={(e) => setSignatoryTitle(e.target.value)}
          placeholder="Chủ tịch"
          maxLength={200}
          disabled={saving}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Input
          label="Document number prefix"
          value={documentNumberPrefix}
          onChange={(e) => setDocumentNumberPrefix(e.target.value)}
          placeholder="QĐ-UBND"
          maxLength={50}
          disabled={saving}
        />
        <div>
          <span id="next-document-number-label" className="block text-metadata font-medium text-text-muted mb-1.5">
            Next document number
          </span>
          <output
            aria-labelledby="next-document-number-label"
            className="control-field block w-full px-3 py-2 text-control text-text-muted bg-surface-strong/50 cursor-not-allowed"
          >
            {profile?.nextDocumentNumber ?? '—'}
          </output>
          <p className="mt-1 text-technical text-text-muted">Managed by server</p>
        </div>
      </div>

      <Button type="submit" isLoading={saving}>
        {saveStatus === 'saved' ? 'Saved' : 'Save'}
      </Button>
    </form>
  );
}
