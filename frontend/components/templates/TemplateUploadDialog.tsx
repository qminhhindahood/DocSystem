'use client';

import React, { useState, useRef, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { AuthError, uploadTemplate } from '@/lib/templates-api';
import { useAuth } from '@/components/auth/AuthProvider';
import { Upload, X, FileText } from 'lucide-react';
import { DOCUMENT_TYPE_OPTIONS } from '@/lib/document-types';

interface TemplateUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
}

const DOC_TYPES = [
  { value: '', label: 'Auto-detect' },
  ...DOCUMENT_TYPE_OPTIONS,
];

export function TemplateUploadDialog({ open, onOpenChange, onUploaded }: TemplateUploadDialogProps) {
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [docType, setDocType] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    setFile(null);
    setName('');
    setDocType('');
    setError(null);
    setUploading(false);
  }, []);

  const validateFile = (f: File): string | null => {
    if (!f.name.toLowerCase().endsWith('.docx')) return 'Only DOCX files are supported';
    if (f.size > 20 * 1024 * 1024) return 'File size exceeds 20 MB limit';
    return null;
  };

  const handleFileSelect = (f: File) => {
    const err = validateFile(f);
    if (err) { setError(err); setFile(null); return; }
    setError(null);
    setFile(f);
    if (!name) setName(f.name.replace(/\.docx$/i, ''));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handleFileSelect(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setUploading(true);
    setError(null);
    try {
      await uploadTemplate(file, name.trim(), docType || undefined);
      reset();
      onOpenChange(false);
      onUploaded();
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      setError(err instanceof Error ? err.message : 'Tải mẫu thất bại');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!uploading) { reset(); onOpenChange(v); } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/55" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-modal max-h-[85vh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel bg-surface-strong p-0 shadow-floating outline-none">
          <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
            <Dialog.Title className="text-section-title text-text-primary">
              Tải mẫu DOCX
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="p-1.5 hover:bg-surface-strong rounded-control transition-colors" aria-label="Đóng">
                <X className="w-5 h-5 text-text-muted" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {error && (
              <div className="rounded-compact bg-error-surface border border-error/30 px-4 py-3 text-control text-error" role="alert">
                {error}
              </div>
            )}

            {/* Drop zone */}
            <div>
              <span id="template-file-label" className="mb-1.5 block text-metadata font-medium text-text-primary">
                Tệp DOCX
              </span>
              <label
                htmlFor="template-file-upload"
                className={`border-2 border-dashed rounded-control px-6 py-8 text-center transition-colors cursor-pointer ${
                  dragOver ? 'border-focus bg-action/10/30' : 'border-hairline hover:border-focus/50'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {file ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileText className="w-6 h-6 text-action" />
                    <div className="text-left">
                      <p className="text-control font-medium text-text-primary">{file.name}</p>
                      <p className="text-metadata text-text-muted">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Upload className="w-8 h-8 text-text-muted" />
                    <p className="text-control text-text-muted">
                      Kéo thả tệp DOCX hoặc <span className="text-action underline underline-offset-2">chọn tệp</span>
                    </p>
                    <p className="text-metadata text-text-muted">Tối đa 20 MB</p>
                  </div>
                )}
              </label>
              <input
                id="template-file-upload"
                aria-labelledby="template-file-label"
                ref={fileInputRef}
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
              />
            </div>

            <Input
              label="Tên mẫu"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ví dụ: Mẫu quyết định"
              required
              disabled={uploading}
            />

            <Select
              label="Loại văn bản"
              value={docType}
              onValueChange={setDocType}
              options={DOC_TYPES}
              disabled={uploading}
            />

            <div className="flex justify-end gap-3 pt-2">
              <Dialog.Close asChild>
                <Button type="button" variant="secondary" disabled={uploading}>Hủy</Button>
              </Dialog.Close>
              <Button type="submit" disabled={!file || !name.trim() || uploading} isLoading={uploading}>
                {uploading ? 'Đang tải...' : 'Tải lên'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
