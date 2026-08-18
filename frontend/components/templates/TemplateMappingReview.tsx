'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  AuthError,
  getTemplatePreviewUrl,
  reviewTemplateMapping,
  type StructuralCandidate,
} from '@/lib/templates-api';
import Image from 'next/image';
import { useAuth } from '@/components/auth/AuthProvider';
import { Save, ArrowLeft } from 'lucide-react';

interface TemplateMappingReviewProps {
  templateId: string;
  templateName: string;
  candidates: StructuralCandidate[];
  compatibility: string[];
  documentFingerprint: string;
  previewPageCount: number;
  onComplete: () => void;
  onBack: () => void;
}

const SEMANTIC_ROLES = [
  { value: 'agency_name', label: 'Issuing agency' },
  { value: 'document_number', label: 'Document number' },
  { value: 'place', label: 'Place' },
  { value: 'date_vn', label: 'Date' },
  { value: 'subject', label: 'Subject / Title' },
  { value: 'recipient', label: 'Recipient' },
  { value: 'legal_basis', label: 'Legal bases' },
  { value: 'content_items', label: 'Body sections' },
  { value: 'distribution_list', label: 'Distribution list' },
  { value: 'signatory_name', label: 'Signatory name' },
  { value: 'signatory_title', label: 'Signatory title' },
  { value: 'signatories', label: 'Multiple signatories' },
  { value: 'appendices', label: 'Appendices' },
  { value: 'security_level', label: 'Security marking' },
  { value: 'urgency_level', label: 'Urgency marking' },
  { value: 'circulation_instructions', label: 'Circulation instructions' },
  { value: 'drafter_code', label: 'Drafter code' },
  { value: 'copy_count', label: 'Copy count' },
  { value: 'agency_address', label: 'Agency address' },
  { value: 'agency_email', label: 'Agency email' },
  { value: 'agency_website', label: 'Agency website' },
  { value: 'agency_phone', label: 'Agency phone' },
];

interface MappingEntry {
  locator: string;
  role: string;
  snippet: string;
}

export function TemplateMappingReview({ templateId, templateName, candidates, compatibility, documentFingerprint, previewPageCount, onComplete, onBack }: TemplateMappingReviewProps) {
  const auth = useAuth();
  const [mappings, setMappings] = useState<MappingEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addMapping = () => setMappings([...mappings, { locator: '', role: '', snippet: '' }]);

  const updateMapping = (i: number, field: keyof MappingEntry, value: string) => {
    const updated = mappings.map((m, idx) => idx === i ? { ...m, [field]: value, snippet: field === 'locator' ? (candidates.find(c => c.locator === value)?.textSnippet ?? m.snippet) : m.snippet } : m);
    setMappings(updated);
  };

  const removeMapping = (i: number) => setMappings(mappings.filter((_, idx) => idx !== i));

  const usedLocators = mappings.map(m => m.locator).filter(Boolean);
  const availableCandidates = candidates.filter(c => !usedLocators.includes(c.locator));

  const handleSave = async () => {
    const validMappings = mappings.filter(m => m.locator && m.role);
    if (validMappings.length === 0) { setError('Add at least one mapping'); return; }
    setSaving(true);
    setError(null);
    try {
      await reviewTemplateMapping(templateId, {
        version: 1,
        documentFingerprint,
        mappings: validMappings.map(mapping => ({
          fieldName: mapping.role,
          locator: mapping.locator,
          kind: candidates.find(candidate => candidate.locator === mapping.locator)?.kind ?? 'UNKNOWN',
          confidence: 1,
        })),
        ignoredLocators: [],
      });
      onComplete();
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-1.5 hover:bg-surface-strong rounded-control transition-colors">
          <ArrowLeft className="w-5 h-5 text-text-muted" />
        </button>
        <div>
          <h2 className="text-section-title">Xem lại ánh xạ trường</h2>
          <p className="text-metadata text-text-muted mt-0.5">{templateName}</p>
        </div>
      </div>

      {error && (
        <div className="rounded-compact bg-error-surface border border-error/30 px-4 py-3 text-control text-error" role="alert">
          {error}
        </div>
      )}

      {/* Compatible types */}
      {compatibility.length > 0 && (
        <div className="rounded-compact bg-error-surface border border-error/30 p-3" role="alert">
          <span className="text-metadata text-error">Unsupported structures:</span>
          {compatibility.map((t) => (
            <span key={t} className="block text-metadata text-error mt-1">{t}</span>
          ))}
        </div>
      )}

      {previewPageCount > 0 && (
        <div>
          <h3 className="text-control font-medium text-text-muted mb-2">Labeled document preview</h3>
          <div className="grid gap-3 max-h-96 overflow-y-auto">
            {Array.from({ length: previewPageCount }, (_, index) => (
              <Image
                key={index}
                src={getTemplatePreviewUrl(templateId, index + 1)}
                alt={`Labeled template preview page ${index + 1}`}
                width={1190}
                height={1684}
                unoptimized
                className="w-full h-auto rounded-control border border-hairline bg-editor"
              />
            ))}
          </div>
        </div>
      )}

      {/* Candidates */}
      {candidates.length > 0 && (
        <div>
          <h3 className="text-control font-medium text-text-muted mb-2">Detected placeholders</h3>
          <div className="grid gap-2 max-h-48 overflow-y-auto">
            {candidates.map((c) => (
              <div key={c.locator} className="flex items-center gap-3 rounded-panel bg-surface-strong p-3 text-control">
                <span className="text-metadata font-mono text-action shrink-0">{c.locator}</span>
                <span className="text-metadata text-text-muted shrink-0">{c.kind}</span>
                <span className="text-metadata text-text-muted truncate">{c.textSnippet}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mappings */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-control font-medium text-text-muted">Semantic mappings</h3>
          <Button type="button" variant="ghost" size="sm" onClick={addMapping}>+ Add mapping</Button>
        </div>
        <div className="space-y-3">
          {mappings.map((m, i) => (
            <div key={i} className="flex items-start gap-2 rounded-panel bg-surface-strong p-3">
              <div className="flex-1">
                <Select
                  label="Placeholder"
                  value={m.locator}
                  onValueChange={(v) => updateMapping(i, 'locator', v)}
                  options={[...availableCandidates.filter(c => c.locator !== m.locator), ...(m.locator ? candidates.filter(c => c.locator === m.locator) : [])].map(c => ({ value: c.locator, label: `${c.locator} — ${c.textSnippet.slice(0, 40)}` }))}
                />
              </div>
              <div className="flex-1">
                <Select
                  label="Semantic role"
                  value={m.role}
                  onValueChange={(v) => updateMapping(i, 'role', v)}
                  options={SEMANTIC_ROLES}
                />
              </div>
              <button
                onClick={() => removeMapping(i)}
                className="mt-6 p-1 rounded hover:bg-surface-strong text-text-muted hover:text-error transition-colors"
                aria-label="Xóa ánh xạ"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={onBack}>Back</Button>
        <Button onClick={handleSave} isLoading={saving} disabled={mappings.length === 0 || compatibility.length > 0}>
          <Save className="w-4 h-4 mr-1.5" />
          {saving ? 'Saving...' : 'Save mapping'}
        </Button>
      </div>
    </div>
  );
}
