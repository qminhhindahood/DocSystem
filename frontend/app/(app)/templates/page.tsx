'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  AuthError,
  deleteTemplate,
  getTemplate,
  getTemplates,
  getTemplateRefetchInterval,
  type TemplateDetail,
  type TemplateSummary,
} from '@/lib/templates-api';
import { TemplateStatusCard } from '@/components/templates/TemplateStatusCard';
import { TemplateUploadDialog } from '@/components/templates/TemplateUploadDialog';
import { TemplateMappingReview } from '@/components/templates/TemplateMappingReview';
import { Button } from '@/components/ui/button';
import { Upload, RefreshCw } from 'lucide-react';
import { cn } from '@/components/lib/cn';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineAlert } from '@/components/ui/inline-alert';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export default function TemplatesPage() {
  const auth = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reviewTemplate, setReviewTemplate] = useState<TemplateDetail | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TemplateSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: ({ signal }) => getTemplates(signal),
    refetchInterval: query => getTemplateRefetchInterval(query.state.data),
    refetchIntervalInBackground: false,
  });
  const templates: TemplateSummary[] = templatesQuery.data?.templates ?? [];
  const loading = templatesQuery.isLoading;
  const visibleError = error ?? (
    templatesQuery.error && !(templatesQuery.error instanceof AuthError)
      ? templatesQuery.error.message || 'Không thể tải danh sách mẫu'
      : null
  );

  useEffect(() => {
    if (templatesQuery.error instanceof AuthError) void auth.refresh();
  }, [auth, templatesQuery.error]);

  const refreshTemplates = useCallback(async () => {
    setError(null);
    await queryClient.invalidateQueries({ queryKey: ['templates'] });
  }, [queryClient]);

  const needsReview = templates.find((t) => t.status === 'NEEDS_REVIEW');

  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    setDeletingId(pendingDelete.id);
    try {
      await deleteTemplate(pendingDelete.id);
      await refreshTemplates();
      setPendingDelete(null);
    } catch (err) {
      // Keep the template in place; ConfirmDialog stays open on rejection.
      setDeleteError(err instanceof Error ? err.message : 'Không thể xóa mẫu');
      throw err;
    } finally {
      setDeletingId(null);
    }
  }, [pendingDelete, refreshTemplates]);

  const openReview = useCallback(async (template: TemplateSummary) => {
    setError(null);
    try {
      const detail = await getTemplate(template.id);
      setReviewTemplate(detail.template);
    } catch (err) {
      if (err instanceof AuthError) { auth.refresh(); return; }
      setError(err instanceof Error ? err.message : 'Không thể tải kết quả phân tích mẫu');
    }
  }, [auth]);

  if (reviewTemplate) {
    return (
      <div className="p-4 sm:p-6">
        <div className="mx-auto max-w-3xl">
          <TemplateMappingReview
            templateId={reviewTemplate.id}
            templateName={reviewTemplate.name}
            candidates={reviewTemplate.previewMetadata?.candidates ?? []}
            compatibility={reviewTemplate.previewMetadata?.compatibility ?? []}
            documentFingerprint={reviewTemplate.previewMetadata?.documentFingerprint ?? ''}
            previewPageCount={reviewTemplate.previewMetadata?.labeledPages?.length ?? 0}
            onComplete={() => { setReviewTemplate(null); void refreshTemplates(); }}
            onBack={() => setReviewTemplate(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Mẫu văn bản"
        description="Quản lý mẫu DOCX dùng khi tạo văn bản."
        actions={
          <>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void templatesQuery.refetch()}
              disabled={templatesQuery.isFetching}
              aria-label="Làm mới danh sách mẫu"
            >
              <RefreshCw
                aria-hidden="true"
                className={cn('h-4 w-4', templatesQuery.isFetching && 'animate-spin')}
              />
            </Button>
            <Button size="lg" className="gap-1.5" onClick={() => setUploadOpen(true)}>
              <Upload aria-hidden="true" className="h-4 w-4" />
              Tải mẫu lên
            </Button>
          </>
        }
      />

      <div className="mx-auto w-full max-w-3xl space-y-5">
        {visibleError && <InlineAlert variant="error">{visibleError}</InlineAlert>}

        {/* Review is the next action for a finished analysis. */}
        {needsReview && !reviewTemplate && (
          <InlineAlert
            variant="warning"
            title="Phân tích mẫu đã hoàn tất"
            action={
              <Button size="sm" onClick={() => openReview(needsReview)}>
                Xem lại
              </Button>
            }
          >
            Cần xem lại ánh xạ của &quot;{needsReview.name}&quot; trước khi sử dụng.
          </InlineAlert>
        )}

        {loading ? (
          <LoadingSkeleton rows={3} label="Đang tải danh sách mẫu" />
        ) : templates.length === 0 ? (
          <EmptyState
            title="Chưa có mẫu nào"
            description="Tải lên một mẫu DOCX để dùng khi tạo văn bản."
            action={
              <Button size="lg" className="gap-1.5" onClick={() => setUploadOpen(true)}>
                <Upload aria-hidden="true" className="h-4 w-4" />
                Tải mẫu đầu tiên
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            {templates.map((t) => (
              <TemplateStatusCard
                key={t.id}
                template={t}
                deleting={deletingId === t.id}
                onDelete={() => setPendingDelete(t)}
                onSelect={() => {
                  if (t.status === 'NEEDS_REVIEW') void openReview(t);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <TemplateUploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUploaded={() => { void refreshTemplates(); }}
      />

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) { setPendingDelete(null); setDeleteError(null); } }}
        title="Xóa mẫu văn bản"
        description={`Mẫu "${pendingDelete?.name ?? ''}" sẽ bị xóa. Hành động này không thể hoàn tác.`}
        confirmLabel="Xóa mẫu"
        destructive
        pending={Boolean(deletingId)}
        onConfirm={confirmDelete}
      >
        {/* Reported inside the dialog: the modal hides page content from
            assistive technology while it is open. */}
        {deleteError && <InlineAlert variant="error">{deleteError}</InlineAlert>}
      </ConfirmDialog>
    </div>
  );
}
