'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/components/lib/cn';

export interface ValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

export interface ValidationPanelProps {
  results: ValidationResult | null;
  className?: string;
}

export function ValidationPanel({ results, className }: ValidationPanelProps) {
  const [showDetails, setShowDetails] = useState(true);

  if (!results) return null;

  const hasIssues = !results.valid || results.warnings.length > 0;

  return (
    <Card className={cn('p-4', className)} variant="elevated">
      <button
        className="w-full flex items-center justify-between"
        onClick={() => setShowDetails(!showDetails)}
        aria-expanded={showDetails}
      >
        <div className="flex items-center gap-2">
          {results.valid ? (
            <CheckCircle className="w-5 h-5 text-success" />
          ) : hasIssues ? (
            <AlertTriangle className="w-5 h-5 text-warning" />
          ) : (
            <XCircle className="w-5 h-5 text-error" />
          )}
          <span className="font-semibold text-control text-text-primary">
            Kiểm tra Nghị định 30/2020
          </span>
          {results.valid ? (
            <Badge variant="success">Hợp lệ</Badge>
          ) : (
            <Badge variant="error">Cần sửa</Badge>
          )}
        </div>
        {showDetails ? (
          <ChevronDown className="w-4 h-4 text-text-muted" />
        ) : (
          <ChevronRight className="w-4 h-4 text-text-muted" />
        )}
      </button>

      {showDetails && (
        <div className="mt-4 space-y-4">
          {results.missing.length > 0 && (
            <div>
              <h4 className="mb-2 text-metadata font-semibold text-error">
                Thiếu nội dung bắt buộc ({results.missing.length})
              </h4>
              <ul className="space-y-1.5">
                {results.missing.map((item, idx) => (
                  <li
                    key={idx}
                    className="text-metadata text-text-muted flex items-start gap-2"
                  >
                    <span className="text-error mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.warnings.length > 0 && (
            <div>
              <h4 className="mb-2 text-metadata font-semibold text-warning">
                Cảnh báo ({results.warnings.length})
              </h4>
              <ul className="space-y-1.5">
                {results.warnings.map((item, idx) => (
                  <li
                    key={idx}
                    className="text-metadata text-text-muted flex items-start gap-2"
                  >
                    <span className="text-warning mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {results.valid && results.warnings.length === 0 && (
            <p className="text-metadata text-success">
              Văn bản đáp ứng tất cả yêu cầu của Nghị định 30/2020.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
