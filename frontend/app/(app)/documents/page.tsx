"use client";

import React, { useCallback, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listDocuments, getDocument, DocumentDetail, DocumentListItem } from "@/lib/api";
import dynamic from "next/dynamic";
import DocumentCard from "@/components/DocumentCard";
import { Plus, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { DocumentsToolbar } from "@/components/documents/DocumentsToolbar";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/lib/use-debounced-value";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 275;

const DocumentDetailModal = dynamic(() => import("@/components/DocumentDetailModal"), {
  ssr: false,
});

export default function DocumentsPage() {
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [docTypeFilter, setDocTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Keystrokes stay immediate in the field; only the settled value is requested.
  const debouncedSearch = useDebouncedValue(searchQuery, SEARCH_DEBOUNCE_MS);

  const { data: result, isPending, error, refetch } = useQuery({
    queryKey: ["documents", docTypeFilter, statusFilter, debouncedSearch, page],
    queryFn: () =>
      listDocuments({
        docType: docTypeFilter || undefined,
        status: statusFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        q: debouncedSearch || undefined,
      }),
    // Keep the previous result on screen while the next one loads.
    placeholderData: keepPreviousData,
  });

  const documents: DocumentListItem[] = result?.data || [];
  const meta = result?.meta || { total: 0, pages: 1, offset: 0 };
  const pageCount = Math.max(1, meta.pages);
  const hasFilters = Boolean(searchQuery || docTypeFilter || statusFilter);

  // Any filter change invalidates the current offset.
  const resetToFirstPage = useCallback(() => setPage(1), []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    resetToFirstPage();
  }, [resetToFirstPage]);

  const handleDocumentTypeChange = useCallback((value: string) => {
    setDocTypeFilter(value);
    resetToFirstPage();
  }, [resetToFirstPage]);

  const handleStatusChange = useCallback((value: string) => {
    setStatusFilter(value);
    resetToFirstPage();
  }, [resetToFirstPage]);

  const handleClear = useCallback(() => {
    setSearchQuery("");
    setDocTypeFilter("");
    setStatusFilter("");
    resetToFirstPage();
  }, [resetToFirstPage]);

  const openDocument = useCallback(async (id: string) => {
    setDetailError(null);
    setPendingId(id);
    try {
      const { data } = await getDocument(id);
      setSelectedDoc(data);
    } catch {
      setDetailError("Không thể tải chi tiết tài liệu. Vui lòng thử lại.");
    } finally {
      setPendingId(null);
    }
  }, []);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Tài liệu"
        meta={<span className="numeric">{meta.total} tài liệu</span>}
        actions={
          <Link
            href="/generate"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-action px-5 text-control font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Tạo tài liệu
          </Link>
        }
      />

      <DocumentsToolbar
        search={searchQuery}
        documentType={docTypeFilter}
        status={statusFilter}
        onSearchChange={handleSearchChange}
        onDocumentTypeChange={handleDocumentTypeChange}
        onStatusChange={handleStatusChange}
        onClear={handleClear}
      />

      {/* List and detail failures are reported separately. */}
      {error && (
        <InlineAlert
          variant="error"
          action={
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              Thử lại
            </Button>
          }
        >
          Không thể tải danh sách tài liệu. Vui lòng thử lại.
        </InlineAlert>
      )}

      {detailError && (
        <InlineAlert
          variant="error"
          action={
            <Button variant="secondary" size="sm" onClick={() => setDetailError(null)}>
              Đóng
            </Button>
          }
        >
          {detailError}
        </InlineAlert>
      )}

      {isPending ? (
        <LoadingSkeleton rows={5} label="Đang tải danh sách tài liệu" />
      ) : documents.length === 0 && !error ? (
        hasFilters ? (
          <EmptyState
            title="Không tìm thấy tài liệu phù hợp"
            description="Thử đổi từ khóa hoặc bộ lọc để xem thêm kết quả."
            action={
              <Button variant="secondary" size="lg" onClick={handleClear}>
                Xóa bộ lọc
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="Chưa có tài liệu"
            description="Tạo tài liệu đầu tiên để bắt đầu quản lý và tra cứu văn bản."
            action={
              <Link
                href="/generate"
                className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-action px-5 text-control font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
              >
                <Plus aria-hidden="true" className="h-4 w-4" />
                Tạo tài liệu
              </Link>
            }
          />
        )
      ) : documents.length > 0 ? (
        <>
          {/* One outer boundary; rows carry no nested cards. */}
          <div className="overflow-hidden rounded-control border border-hairline">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Danh sách tài liệu đã tạo</caption>
              <thead className="hidden bg-surface-strong sm:table-header-group">
                <tr>
                  <th scope="col" className="px-4 py-2.5 text-control text-text-secondary">
                    Tài liệu
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-control text-text-secondary">
                    Loại tài liệu
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-control text-text-secondary">
                    Cập nhật
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-control text-text-secondary">
                    Trạng thái
                  </th>
                  <th scope="col" className="px-4 py-2.5">
                    <span className="sr-only">Mở chi tiết</span>
                  </th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {documents.map((doc) => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    pending={pendingId === doc.id}
                    onClick={() => void openDocument(doc.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {pageCount > 1 && (
            <nav aria-label="Phân trang tài liệu" className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="lg"
                aria-label="Trang trước"
                disabled={page <= 1}
                onClick={() => setPage((value) => Math.max(1, value - 1))}
              >
                <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                Trước
              </Button>
              <span aria-live="polite" className="text-metadata text-text-secondary numeric">
                Trang {page} / {pageCount}
              </span>
              <Button
                variant="secondary"
                size="lg"
                aria-label="Trang sau"
                disabled={page >= pageCount}
                onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
              >
                Sau
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </nav>
          )}
        </>
      ) : null}

      {selectedDoc && (
        <DocumentDetailModal
          document={selectedDoc}
          open={true}
          onOpenChange={(open) => { if (!open) setSelectedDoc(null); }}
        />
      )}
    </div>
  );
}
