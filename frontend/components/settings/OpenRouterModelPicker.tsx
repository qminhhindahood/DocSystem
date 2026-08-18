'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ChevronDown, Search, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/lib/cn';
import { getOpenRouterModels, type OpenRouterModel } from '@/lib/settings-api';

export interface OpenRouterModelPickerProps {
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}

function formatContext(value: number | null): string | null {
  if (value === null) return null;
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M ngữ cảnh`;
  return `${Math.round(value / 1_000)}K ngữ cảnh`;
}

function formatPrice(model: OpenRouterModel): string | null {
  if (model.free) return null;
  const input = model.promptPricePerMillion;
  const output = model.completionPricePerMillion;
  if (input === null || output === null) return null;
  return `$${input.toLocaleString('en-US', { maximumFractionDigits: 4 })}/M vào · $${output.toLocaleString('en-US', { maximumFractionDigits: 4 })}/M ra`;
}

export function OpenRouterModelPicker({ value, onValueChange, disabled }: OpenRouterModelPickerProps) {
  const inputId = useId();
  const listboxId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [manualMode, setManualMode] = useState(false);
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retryVersion, setRetryVersion] = useState(0);

  useEffect(() => {
    if (!open || manualMode) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(false);
      getOpenRouterModels(query, controller.signal)
        .then((result) => {
          setModels(result.models);
          setTotal(result.total);
          setActiveIndex(-1);
        })
        .catch((requestError) => {
          if (!(requestError instanceof DOMException && requestError.name === 'AbortError')) {
            setModels([]);
            setTotal(0);
            setError(true);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, query ? 250 : 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [manualMode, open, query, retryVersion]);

  const groups = useMemo(() => [
    { label: 'Mô hình đề xuất', models: models.filter((model) => model.recommended) },
    { label: 'Mô hình miễn phí', models: models.filter((model) => !model.recommended && model.free) },
    { label: 'Tất cả mô hình', models: models.filter((model) => !model.recommended && !model.free) },
  ].filter((group) => group.models.length > 0), [models]);

  function closePicker() {
    setOpen(false);
    setQuery('');
    setActiveIndex(-1);
  }

  function chooseModel(model: OpenRouterModel) {
    onValueChange(model.id);
    closePicker();
  }

  function enterManualMode() {
    setManualMode(true);
    closePicker();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) setOpen(true);
      if (models.length) setActiveIndex((index) => Math.min(index + 1, models.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (models.length) setActiveIndex((index) => index <= 0 ? models.length - 1 : index - 1);
    } else if (event.key === 'Enter' && activeIndex >= 0 && models[activeIndex]) {
      event.preventDefault();
      chooseModel(models[activeIndex]);
    } else if (event.key === 'Escape') {
      closePicker();
    }
  }

  if (manualMode) {
    return <div className="space-y-1.5">
      <Input
        label="ID mô hình thủ công"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        placeholder="Ví dụ: openai/gpt-4.1-mini"
        disabled={disabled}
        required
      />
      <Button
        type="button"
        variant="link"
        size="sm"
        disabled={disabled}
        onClick={() => setManualMode(false)}
      >
        Chọn từ danh mục
      </Button>
    </div>;
  }

  return <div className="w-full">
    <label htmlFor={inputId} className="mb-1.5 block text-metadata font-medium text-text-primary">
      Mô hình
    </label>
    <Popover.Root open={open} onOpenChange={(next) => {
      setOpen(next);
      if (!next) {
        setQuery('');
        setActiveIndex(-1);
      }
    }}>
      <div className="relative">
        <Popover.Anchor asChild>
          <input
            type="text"
            id={inputId}
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={listboxId}
            aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
            value={open ? query : value}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!open) setOpen(true);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Tìm theo tên hoặc ID mô hình"
            className="control-field pr-11"
            disabled={disabled}
            required
          />
        </Popover.Anchor>
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      </div>

      <Popover.Portal>
        <Popover.Content
          role="presentation"
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-popover w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-panel border border-hairline bg-surface shadow-floating"
        >
          <div className="border-b border-hairline px-3 py-2 text-metadata text-text-muted">
            <span className="inline-flex items-center gap-2">
              <Search aria-hidden="true" className="h-3.5 w-3.5" />
              Tìm theo tên nhà cung cấp hoặc ID
            </span>
          </div>
          <div id={listboxId} role="listbox" aria-label="Danh mục mô hình OpenRouter" className="max-h-72 overflow-y-auto p-1">
            {loading && <div role="status" className="space-y-2 p-2" aria-label="Đang tải mô hình">
              {[0, 1, 2].map((item) => <div key={item} className="h-11 animate-pulse rounded-control bg-surface-strong" />)}
            </div>}
            {!loading && error && <div role="alert" className="p-3 text-metadata text-text-muted">
              <p>Không thể tải danh mục mô hình OpenRouter.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button type="button" variant="secondary" size="sm" onClick={() => setRetryVersion((version) => version + 1)}>Thử lại</Button>
                <Button type="button" variant="link" size="sm" onClick={enterManualMode}>Nhập ID mô hình thủ công</Button>
              </div>
            </div>}
            {!loading && !error && models.length === 0 && <div className="p-3 text-metadata text-text-muted">
              <p>Không tìm thấy mô hình phù hợp.</p>
              <Button type="button" variant="link" size="sm" className="mt-2" onClick={enterManualMode}>Nhập ID mô hình thủ công</Button>
            </div>}
            {!loading && !error && groups.map((group) => <div key={group.label}>
              <p className="px-3 pb-1 pt-3 text-metadata font-semibold uppercase tracking-wide text-text-muted">{group.label}</p>
              {group.models.map((model) => {
                const modelIndex = models.findIndex((candidate) => candidate.id === model.id);
                const context = formatContext(model.contextLength);
                const price = formatPrice(model);
                return <button
                  key={model.id}
                  id={`${listboxId}-option-${modelIndex}`}
                  type="button"
                  role="option"
                  aria-selected={model.id === value}
                  onMouseEnter={() => setActiveIndex(modelIndex)}
                  onClick={() => chooseModel(model)}
                  className={cn(
                    'flex min-h-11 w-full items-start gap-3 rounded-control px-3 py-2 text-left outline-none transition-colors duration-fast',
                    'hover:bg-action/10 focus-visible:ring-2 focus-visible:ring-focus',
                    activeIndex === modelIndex && 'bg-action/10',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-body font-medium text-text-primary">{model.name}</span>
                      {model.recommended && <Badge variant="info" className="gap-1 py-0.5"><Star aria-hidden="true" className="h-3 w-3" />Đề xuất</Badge>}
                      {model.free && <Badge variant="success" className="py-0.5">Miễn phí</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-metadata text-text-muted">{model.id}</p>
                    {(context || price) && <p className="mt-0.5 text-metadata text-text-muted">{[context, price].filter(Boolean).join(' · ')}</p>}
                  </div>
                </button>;
              })}
            </div>)}
          </div>
          {!loading && !error && models.length > 0 && <div className="flex items-center justify-between gap-3 border-t border-hairline px-3 py-2">
            <p role="status" className="text-metadata text-text-muted">Hiển thị {models.length}/{total} mô hình</p>
            <Button type="button" variant="link" size="sm" onClick={enterManualMode}>Nhập ID mô hình thủ công</Button>
          </div>}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
