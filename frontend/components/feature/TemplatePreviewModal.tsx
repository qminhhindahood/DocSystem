'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { FileText, X, Download, Eye, Edit3 } from 'lucide-react';
import { cn } from '@/components/lib/cn';

export interface FieldEntry {
  name: string;
  label: string;
  value: string;
  type?: 'text' | 'date' | 'textarea' | 'select' | 'list' | 'number' | 'boolean' | 'object-list' | 'table';
}

interface TemplatePreviewModalProps {
  open: boolean;
  onClose: () => void;
  content: string;
  docType: string;
  docTypeName: string;
  fields: FieldEntry[];
  onDownload: (updatedFields: Record<string, string>) => void;
  onFieldsChange: (fields: FieldEntry[]) => void;
}

export function TemplatePreviewModal({
  open,
  onClose,
  content,
  docTypeName,
  fields,
  onDownload,
  onFieldsChange,
}: TemplatePreviewModalProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'fields'>('fields');
  const [localFields, setLocalFields] = useState<FieldEntry[]>(fields);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    setLocalFields(fields);
  }, [fields]);

  const handleFieldChange = (name: string, value: string) => {
    const updated = localFields.map((f) =>
      f.name === name ? { ...f, value } : f,
    );
    setLocalFields(updated);
    onFieldsChange(updated);
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const updatedValues: Record<string, string> = {};
      for (const f of localFields) {
        if (f.value.trim()) updatedValues[f.name] = f.value.trim();
      }
      onDownload(updatedValues);
    } finally {
      setIsDownloading(false);
    }
  };

  const previewLines = content.split('\n').slice(0, 30);
  const hasMore = content.split('\n').length > 30;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-backdrop flex items-center justify-center bg-black/55"
    >
      <button
        type="button"
        aria-label="Đóng cửa sổ xem trước"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="template-preview-title"
        className="relative z-modal mx-4 flex max-h-[85vh] w-full max-w-2xl flex-col rounded-panel bg-surface-strong shadow-floating"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-hairline">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-control bg-action/10">
              <FileText className="w-5 h-5 text-action" />
            </div>
            <div>
              <h2 id="template-preview-title" className="text-section-title text-text-primary">
                Xem trước văn bản
              </h2>
              <p className="text-control text-text-muted">
                {docTypeName} · Kiểm tra thông tin trước khi tải xuống
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-control hover:bg-surface-strong text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b border-hairline px-6">
          <button
            onClick={() => setActiveTab('fields')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-control font-medium border-b-2 transition-colors',
              activeTab === 'fields'
                ? 'border-focus text-action'
                : 'border-transparent text-text-muted hover:text-text-muted'
            )}
          >
            <Edit3 className="w-4 h-4" />
            Thông tin chi tiết
          </button>
          <button
            onClick={() => setActiveTab('preview')}
            className={cn(
              'flex items-center gap-2 px-4 py-3 text-control font-medium border-b-2 transition-colors',
              activeTab === 'preview'
                ? 'border-focus text-action'
                : 'border-transparent text-text-muted hover:text-text-muted'
            )}
          >
            <Eye className="w-4 h-4" />
            Xem trước nội dung
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === 'fields' ? (
            <div className="space-y-4">
              <p className="text-control text-text-muted mb-3">
                Các trường thông tin dưới đây sẽ được sử dụng để tạo file DOCX.
                Bạn có thể chỉnh sửa trước khi tải xuống.
              </p>
              {localFields.length === 0 ? (
                <div className="text-center py-8 text-text-muted">
                  <p className="text-control">Không có trường thông tin nào</p>
                  <p className="text-metadata mt-1">
                    Vui lòng điền thông tin chi tiết ở bảng điều khiển bên trái
                  </p>
                </div>
              ) : (
                localFields.map((field) => (
                  <div key={field.name}>
                    <label className="block text-control font-medium text-text-muted mb-1">
                      {field.label}
                    </label>
                    {['textarea', 'list', 'object-list', 'table'].includes(field.type || '') ? (
                      <textarea
                        value={field.value}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        rows={3}
                        className="control-field w-full text-control"
                      />
                    ) : (
                      <input
                        type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
                        value={field.value}
                        onChange={(e) => handleFieldChange(field.name, e.target.value)}
                        className="control-field w-full text-control"
                      />
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="bg-canvas rounded-control p-4 font-mono text-control leading-relaxed whitespace-pre-wrap text-text-primary max-h-[50vh] overflow-y-auto border border-hairline">
              {previewLines.join('\n')}
              {hasMore && (
                <p className="mt-2 text-metadata text-text-muted">
                  ... (còn tiếp)
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-hairline">
          <Button variant="secondary" size="md" onClick={onClose}>
            Quay lại
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={handleDownload}
            disabled={isDownloading || localFields.length === 0}
            className="flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {isDownloading ? 'Đang tải...' : 'Tải file DOCX'}
          </Button>
        </div>
      </div>
    </div>
  );
}
