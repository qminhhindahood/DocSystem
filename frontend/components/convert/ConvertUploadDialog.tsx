'use client';

import React, { useState, useRef, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Button } from '@/components/ui/button';
import { AuthError, submitConversion, submitBulkConversion } from '@/lib/convert-api';
import { useAuth } from '@/components/auth/AuthProvider';
import { Upload, X, FileText } from 'lucide-react';

export interface SubmittedJob {
  jobId: string;
  filename: string;
  file: File;
}

interface ConvertUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted: (jobs: SubmittedJob[]) => void;
}

const MAX_SIZE = 50 * 1024 * 1024;
const MAX_FILES = 10;

export function ConvertUploadDialog({ open, onOpenChange, onSubmitted }: ConvertUploadDialogProps) {
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = useCallback(() => {
    setFiles([]);
    setError(null);
    setUploading(false);
  }, []);

  const validateFile = (f: File): string | null => {
    if (!f.name.toLowerCase().endsWith('.pdf')) return `Chỉ chấp nhận tệp PDF: ${f.name}`;
    if (f.size > MAX_SIZE) return `Tệp vượt quá giới hạn 50 MB: ${f.name}`;
    return null;
  };

  const handleFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (files.length + list.length > MAX_FILES) {
      setError(`Tối đa ${MAX_FILES} tệp mỗi lần chuyển đổi`);
      return;
    }
    const errors: string[] = [];
    const valid: File[] = [];
    for (const f of list) {
      const err = validateFile(f);
      if (err) { errors.push(err); continue; }
      valid.push(f);
    }
    setError(errors.length ? errors.join('; ') : null);
    setFiles((prev) => [...prev, ...valid]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const submitted = files;
      let jobs: SubmittedJob[] = [];
      const first = submitted[0];
      if (submitted.length === 1 && first) {
        const { jobId } = await submitConversion(first);
        jobs = [{ jobId, filename: first.name, file: first }];
      } else {
        const result = await submitBulkConversion(files);
        for (const j of result.jobs) {
          if (j.jobId === null) continue;
          const file = submitted.find((f) => f.name === j.filename);
          if (!file) continue;
          jobs.push({ jobId: j.jobId, filename: j.filename, file });
        }
        const failed = result.jobs.filter((j) => j.error);
        if (failed.length > 0) {
          setError(failed.map((f) => `${f.filename}: ${f.error}`).join('; '));
        }
      }
      reset();
      onOpenChange(false);
      if (jobs.length > 0) onSubmitted(jobs);
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      setError(err instanceof Error ? err.message : 'Chuyển đổi thất bại');
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
              Chuyển đổi PDF sang Word
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-control p-1.5 text-text-secondary hover:bg-surface hover:text-text-primary" aria-label="Đóng">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="px-6 py-5 space-y-4">
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={
                'flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 rounded-panel border-2 border-dashed p-6 text-center transition-colors ' +
                (dragOver ? 'border-action bg-action/5' : 'border-hairline hover:border-action/50')
              }
            >
              <Upload className="h-6 w-6 text-text-secondary" aria-hidden="true" />
              {files.length > 0 ? (
                <ul className="flex max-h-28 w-full flex-col gap-1 overflow-y-auto text-left">
                  {files.map((f) => (
                    <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 text-control text-text-primary">
                      <FileText className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{f.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  <span className="text-control font-medium text-text-primary">Kéo thả tệp PDF vào đây</span>
                  <span className="text-body text-text-secondary">hoặc bấm để chọn tệp (tối đa {MAX_FILES} tệp, 50 MB/tệp)</span>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
              />
            </div>

            {error && (
              <p role="alert" className="whitespace-pre-line rounded-control bg-danger/10 px-3 py-2 text-body text-danger">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="secondary" disabled={uploading}>Hủy</Button>
              </Dialog.Close>
              <Button onClick={handleSubmit} disabled={files.length === 0 || uploading}>
                {uploading ? 'Đang tải lên…' : `Chuyển đổi (${files.length})`}
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}