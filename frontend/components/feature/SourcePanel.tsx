'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/components/lib/cn';

export interface SourceChunk {
  id: string;
  content: string;
  article?: string;
  clause?: string;
  documentTitle?: string;
  relevanceScore?: number;
}

export interface SourcePanelProps {
  sources: SourceChunk[];
  className?: string;
}

export function SourcePanel({ sources, className }: SourcePanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  if (!sources || sources.length === 0) return null;

  return (
    <Card className={cn('p-4', className)} variant="elevated">
      <h3 className="font-semibold text-control text-text-muted mb-3 flex items-center gap-2">
        <FileText className="w-4 h-4" />
        Nguồn tham khảo ({sources.length})
      </h3>
      <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
        {sources.map((source, idx) => {
          const isExpanded = expanded.has(source.id);
          return (
            <div
              key={source.id || idx}
              className="border border-hairline rounded-control overflow-hidden bg-surface-strong"
            >
              <button
                className="w-full flex items-center justify-between p-2.5 text-left hover:bg-surface-strong transition-colors"
                onClick={() => toggleExpand(source.id || String(idx))}
                aria-expanded={isExpanded}
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isExpanded ? (
                    <ChevronDown className="w-4 h-4 flex-shrink-0 text-action" />
                  ) : (
                    <ChevronRight className="w-4 h-4 flex-shrink-0 text-text-muted" />
                  )}
                  <span className="text-metadata font-medium text-text-primary truncate">
                    Nguồn {idx + 1}
                  </span>
                  {source.article && (
                    <Badge variant="info" className="text-technical">
                      {source.article}
                    </Badge>
                  )}
                  {source.relevanceScore && (
                    <Badge
                      variant={source.relevanceScore > 0.7 ? 'success' : 'default'}
                      className="text-technical"
                    >
                      {(source.relevanceScore * 100).toFixed(0)}%
                    </Badge>
                  )}
                </div>
              </button>
              {isExpanded && (
                <div className="p-3 border-t border-hairline bg-canvas/50">
                  <p className="text-metadata text-text-muted whitespace-pre-wrap line-clamp-6">
                    {source.content}
                  </p>
                  {source.documentTitle && (
                    <p className="mt-2 text-metadata text-text-muted">
                      Từ: {source.documentTitle}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
