'use client';

import React from 'react';
import { Search, X } from 'lucide-react';
import { DOCUMENT_TYPE_OPTIONS } from '@/lib/document-types';
import { DOCUMENT_STATUS_FILTER_OPTIONS } from '@/lib/ui/document-status';

export interface DocumentsToolbarProps {
  search: string;
  documentType: string;
  status: string;
  onSearchChange: (value: string) => void;
  onDocumentTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onClear: () => void;
}

const DOC_TYPE_OPTIONS = [
  { value: '', label: 'Tất cả loại' },
  ...DOCUMENT_TYPE_OPTIONS,
];

const selectClass =
  'control-field text-control sm:w-48';

export function DocumentsToolbar({
  search,
  documentType,
  status,
  onSearchChange,
  onDocumentTypeChange,
  onStatusChange,
  onClear,
}: DocumentsToolbarProps) {
  const hasFilters = Boolean(search || documentType || status);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative min-w-0 flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
        />
        <input
          id="document-search"
          name="document-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          aria-label="Tìm kiếm tài liệu"
          placeholder="Tìm kiếm tài liệu"
          className="control-field control-field-leading-icon rounded-pill text-control"
        />
      </div>

      <select
        id="document-type"
        name="document-type"
        value={documentType}
        onChange={(event) => onDocumentTypeChange(event.target.value)}
        aria-label="Lọc theo loại văn bản"
        className={selectClass}
      >
        {DOC_TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      <select
        id="document-status"
        name="document-status"
        value={status}
        onChange={(event) => onStatusChange(event.target.value)}
        aria-label="Lọc theo trạng thái"
        className={selectClass}
      >
        {DOCUMENT_STATUS_FILTER_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {/* Only offered when it would do something. */}
      {hasFilters && (
        <button
          type="button"
          onClick={onClear}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-control px-3 text-control text-text-secondary transition-colors duration-fast hover:bg-surface-strong hover:text-text-primary"
        >
          <X aria-hidden="true" className="h-4 w-4" />
          Xóa bộ lọc
        </button>
      )}
    </div>
  );
}
