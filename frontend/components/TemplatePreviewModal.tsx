"use client";

import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, FileText, Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TemplateSummary } from "@/lib/templates-api";

interface TemplatePreviewModalProps {
  template: TemplateSummary & { content?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function TemplatePreviewModal({
  template,
  open,
  onOpenChange,
}: TemplatePreviewModalProps) {
  const date = new Date(template.updatedAt).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/55" />
        <Dialog.Content className="fixed z-modal top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-2xl max-h-[85vh] rounded-panel bg-surface-strong shadow-floating flex flex-col outline-none">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-hairline shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-control bg-action/10 flex items-center justify-center">
                <FileText className="w-5 h-5 text-action" />
              </div>
              <div>
                <Dialog.Title className="text-section-title font-bold text-text-primary">
                  {template.name}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  Preview for template {template.name}
                </Dialog.Description>
                <div className="flex items-center gap-3 mt-0.5 text-metadata text-text-muted">
                  <Badge variant="info" className="text-technical">
                    {template.docType}
                  </Badge>
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {date}
                  </span>
                </div>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                className="p-2 rounded-control hover:bg-surface-strong text-text-muted hover:text-text-primary transition-colors"
                aria-label="Đóng"
              >
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {template.content ? (
              <div className="text-control text-text-primary leading-relaxed whitespace-pre-wrap">
                {template.content}
              </div>
            ) : (
              <div className="text-control text-text-muted text-center py-8">
                Nội dung mẫu chưa được tải.
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
