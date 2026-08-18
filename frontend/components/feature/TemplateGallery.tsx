'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, Loader2 } from 'lucide-react';
import { cn } from '@/components/lib/cn';

export interface Template {
  id: string;
  name: string;
  description: string;
  documentType: string;
  fields: TemplateField[];
  previewImage?: string;
}

export interface TemplateField {
  name: string;
  label: string;
  type: 'text' | 'textarea' | 'date' | 'number';
  required?: boolean;
  defaultValue?: string;
}

export interface TemplateGalleryProps {
  onSelect: (template: Template) => void;
  selectedTemplateId?: string;
  className?: string;
}

export function TemplateGallery({
  onSelect,
  selectedTemplateId,
  className,
}: TemplateGalleryProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch('/api/templates');
        if (!res.ok) throw new Error('Failed to fetch templates');
        const data = await res.json();
        setTemplates(data.templates || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lỗi tải mẫu văn bản');
      } finally {
        setIsLoading(false);
      }
    }
    fetchTemplates();
  }, []);

  if (isLoading) {
    return (
      <div className={cn('space-y-3', className)}>
        <h3 className="font-semibold text-control text-text-muted">
          Mẫu văn bản
        </h3>
        <div className="flex items-center justify-center py-8 text-text-muted">
          <Loader2 className="w-5 h-5 animate-spin mr-2" />
          <span className="text-control">Đang tải...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('space-y-3', className)}>
        <h3 className="font-semibold text-control text-text-muted">
          Mẫu văn bản
        </h3>
        <div className="text-control text-error bg-error-surface border border-error/30 p-3 rounded-control">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <h3 className="font-semibold text-control text-text-muted">
        Mẫu văn bản
      </h3>
      <div className="grid grid-cols-1 gap-2.5">
        {templates.map((template) => {
          const isSelected = template.id === selectedTemplateId;
          return (
            <Card
              key={template.id}
              className={cn(
                'cursor-pointer transition-all duration-200 p-3 animate-fade-in',
                isSelected
                  ? 'border-focus bg-action/10 '
                  : 'border-hairline hover:border-border-strong hover:bg-surface-strong'
              )}
              onClick={() => onSelect(template)}
              role="button"
              tabIndex={0}
              aria-pressed={isSelected}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(template);
                }
              }}
            >
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 bg-surface-strong rounded-control flex items-center justify-center flex-shrink-0 relative border border-hairline">
                  {template.previewImage ? (
                    <Image
                      src={template.previewImage}
                      alt=""
                      fill
                      className="object-cover rounded-control"
                      unoptimized
                    />
                  ) : (
                    <FileText className="w-5 h-5 text-text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-control text-text-primary truncate">
                    {template.name}
                  </h4>
                  <p className="text-metadata text-text-muted mt-0.5 line-clamp-2">
                    {template.description}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {template.fields.slice(0, 3).map((field) => (
                      <Badge key={field.name} variant="info" className="text-technical">
                        {field.label}
                      </Badge>
                    ))}
                    {template.fields.length > 3 && (
                      <Badge variant="default" className="text-technical">
                        +{template.fields.length - 3} more
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
        {templates.length === 0 && (
          <p className="text-control text-text-muted text-center py-4">
            Không có mẫu văn bản nào
          </p>
        )}
      </div>
    </div>
  );
}
