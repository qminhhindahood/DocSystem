"use client";

import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Download } from "lucide-react";
import { downloadDocumentAsDocx } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { DocumentDetail } from '@/lib/api';
import { FidelityWarningPanel } from '@/components/feature/FidelityWarningPanel';
import {
  DocumentConfidenceStrip,
  buildDocumentConfidenceItems,
} from '@/components/documents/DocumentConfidenceStrip';
import { ExportConfirmationDialog } from '@/components/documents/ExportConfirmationDialog';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';
import { formatDocumentType } from '@/lib/document-types';

interface DocumentDetailModalProps {
  document: DocumentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function DocumentDetailModal({ document, open, onOpenChange }: DocumentDetailModalProps) {
  const [exporting, setExporting] = useState(false);
  const [confirmExport, setConfirmExport] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const generation = document.metadata?.generation;
  const fidelityReport = generation?.fidelityReport;
  const exportUnavailable = generation !== undefined && generation.state !== 'verified';
  const confidenceItems = buildDocumentConfidenceItems(generation);
  const title = document.title || "Văn bản chưa đặt tên";

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await downloadDocumentAsDocx(document.id, document.title);
    } catch (error) {
      setExportError('Không thể xuất tài liệu. Vui lòng thử lại.');
      throw error;
    } finally {
      setExporting(false);
    }
  };

  const created = new Date(document.createdAt).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-modal flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-panel border border-hairline bg-surface shadow-floating outline-none">
          {/* Identity and actions come first. */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-hairline px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="text-section-title text-text-primary">
                {title}
              </Dialog.Title>
              <Dialog.Description className="sr-only">
                Chi tiết tài liệu {title}
              </Dialog.Description>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <Badge variant="info">{formatDocumentType(document.docType)}</Badge>
                <DocumentStatusBadge status={document.status} />
                <span className="text-metadata text-text-muted numeric">{created}</span>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button
                onClick={() => setConfirmExport(true)}
                disabled={exportUnavailable}
                size="sm"
                className="gap-1.5"
              >
                <Download aria-hidden="true" className="h-4 w-4" />
                Xuất DOCX
              </Button>
              <Dialog.Close asChild>
                <button
                  className="flex h-11 w-11 items-center justify-center rounded-compact text-text-secondary transition-colors hover:bg-surface-strong hover:text-text-primary"
                  aria-label="Đóng"
                >
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </div>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
            {/* Trust summary before long content, only when real values exist. */}
            <DocumentConfidenceStrip items={confidenceItems} />

            {exportError && <InlineAlert variant="error">{exportError}</InlineAlert>}

            {/* Document body is the centre of gravity. */}
            <div className="whitespace-pre-wrap text-body text-text-primary">
              {document.content}
            </div>

            {document.chunks.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-control font-semibold text-text-primary">
                  Đoạn văn bản đã phân tích ({document.chunks.length})
                </h3>
                <ul className="divide-y divide-hairline overflow-hidden rounded-control border border-hairline">
                  {document.chunks.map((chunk) => (
                    <li key={chunk.id} className="px-3 py-2.5">
                      <span className="text-metadata text-text-muted">Đoạn {chunk.level}</span>
                      <p className="mt-1 line-clamp-3 text-metadata text-text-secondary">
                        {chunk.content}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Fidelity and validation are supporting detail, not the headline. */}
            {fidelityReport && <FidelityWarningPanel fidelity={fidelityReport} />}
          </div>

          <ExportConfirmationDialog
            open={confirmExport}
            onOpenChange={setConfirmExport}
            filename={`${title}.docx`}
            validationStatus={generation?.validationStatus ?? fidelityReport?.validationStatus}
            pending={exporting}
            onConfirm={handleExport}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
