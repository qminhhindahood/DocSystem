"use client";

import React from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { DocumentListItem } from "../lib/api";
import { formatDocumentType } from '@/lib/document-types';
import { DocumentStatusBadge } from '@/components/documents/DocumentStatusBadge';

interface DocumentCardProps {
  document: DocumentListItem;
  onClick: () => void;
  pending?: boolean;
}

const formatUpdatedAt = (value: string) =>
  new Date(value).toLocaleDateString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

/**
 * One document row. Real table cells at `sm` and above; below that each cell becomes
 * a labelled block so the column relationships survive the reflow.
 *
 * Uses only `DocumentListItem` fields — the contract carries no folder, uploader,
 * file size, or archive data.
 */
export default function DocumentCard({ document, onClick, pending }: DocumentCardProps) {
  const title = document.title || "Văn bản chưa đặt tên";

  return (
    <tr className="block border-b border-hairline last:border-b-0 hover:bg-surface-subtle sm:table-row">
      <td className="block px-4 pt-3 sm:table-cell sm:min-h-[56px] sm:py-3">
        <button
          type="button"
          onClick={onClick}
          aria-busy={pending || undefined}
          className="w-full text-left text-body font-medium text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:line-clamp-2"
        >
          {title}
        </button>
        {document._count.chunks > 0 && (
          <span className="mt-0.5 block text-metadata text-text-muted numeric">
            {document._count.chunks} đoạn
          </span>
        )}
      </td>

      <td className="block px-4 pt-1 text-metadata text-text-secondary sm:table-cell sm:py-3">
        <span aria-hidden="true" className="text-text-muted sm:hidden">Loại tài liệu: </span>
        {formatDocumentType(document.docType)}
      </td>

      <td className="block px-4 pt-1 text-metadata text-text-secondary numeric sm:table-cell sm:py-3">
        <span aria-hidden="true" className="text-text-muted sm:hidden">Cập nhật: </span>
        {formatUpdatedAt(document.updatedAt)}
      </td>

      <td className="block px-4 pt-2 pb-3 sm:table-cell sm:py-3">
        <DocumentStatusBadge status={document.status} />
      </td>

      <td className="hidden text-right sm:table-cell sm:py-3 sm:pr-4">
        {pending ? (
          <Loader2 aria-hidden="true" className="inline h-4 w-4 animate-spin text-action" />
        ) : (
          <ChevronRight aria-hidden="true" className="inline h-4 w-4 text-text-muted" />
        )}
      </td>
    </tr>
  );
}
