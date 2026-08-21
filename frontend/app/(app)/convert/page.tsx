"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Download, FileText, FileOutput, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConvertUploadDialog, SubmittedJob } from "@/components/convert/ConvertUploadDialog";
import {
  getConversionStatus,
  getConversionReport,
  conversionResultUrl,
  ConversionReport,
  ConversionStatus,
} from "@/lib/convert-api";

interface ConversionJob {
  jobId: string;
  filename: string;
  sourceUrl: string | null; // object URL for the uploaded PDF preview
  status: ConversionStatus | null;
  error: string | null;
  report: ConversionReport | null;
  reportOpen: boolean;
}

const POLL_INTERVAL_MS = 1500;

const STATUS_LABELS: Record<string, string> = {
  queued: "Trong hàng đợi",
  processing: "Đang chuyển đổi",
  completed: "Hoàn thành",
  completed_with_warnings: "Hoàn thành (có cảnh báo)",
  failed: "Thất bại",
};

function statusOf(job: ConversionJob): string {
  return job.status?.status ?? "queued";
}

function isTerminal(status: string): boolean {
  return status === "completed" || status === "completed_with_warnings" || status === "failed";
}

export default function ConvertPage() {
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const jobsRef = useRef<ConversionJob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const updateJob = useCallback((jobId: string, patch: Partial<ConversionJob>) => {
    setJobs((prev) => {
      const next = prev.map((job) => (
        job.jobId === jobId ? { ...job, ...patch } : job
      ));
      jobsRef.current = next;
      return next;
    });
  }, []);

  const pollActiveJobs = useCallback(async () => {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const activeJobs = jobsRef.current.filter((job) => !isTerminal(statusOf(job)));
      for (const job of activeJobs) {
        try {
          const status = await getConversionStatus(job.jobId);
          updateJob(job.jobId, { status, error: status.error ?? null });
        } catch (err) {
          // A transient read error does not discard the job or stop later polls.
          updateJob(job.jobId, {
            error: err instanceof Error ? err.message : "Không thể cập nhật trạng thái",
          });
        }
      }
      if (!jobsRef.current.some((job) => !isTerminal(statusOf(job)))) {
        stopPolling();
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, [stopPolling, updateJob]);

  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      void pollActiveJobs();
    }, POLL_INTERVAL_MS);
  }, [pollActiveJobs]);

  // Track created object URLs so the unmount cleanup can revoke them
  // (the browser keeps the Blob alive until revoked even after navigation).
  const urlsRef = useRef<Map<string, string>>(new Map());

  // Clean up the shared timer + object URLs on unmount.
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      stopPolling();
      pollInFlightRef.current = false;
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, [stopPolling]);

  const handleSubmitted = useCallback((submittedJobs: SubmittedJob[]) => {
    setJobs((prev) => {
      const next = [
        ...submittedJobs.map((job) => {
          const url = URL.createObjectURL(job.file);
          urlsRef.current.set(job.jobId, url);
          return ({
            jobId: job.jobId,
            filename: job.filename,
            sourceUrl: url,
            status: null,
            error: null,
            report: null,
            reportOpen: false,
          });
        }),
        ...prev,
      ];
      jobsRef.current = next;
      return next;
    });
    startPolling();
  }, [startPolling]);

  const loadReport = useCallback(async (jobId: string) => {
    try {
      const report = await getConversionReport(jobId);
      updateJob(jobId, { report });
    } catch {
      updateJob(jobId, { report: null });
    }
  }, [updateJob]);

  const toggleReport = useCallback((jobId: string) => {
    setJobs((prev) => prev.map((j) => {
      if (j.jobId !== jobId) return j;
      if (!j.report) void loadReport(jobId);
      return { ...j, reportOpen: !j.reportOpen };
    }));
  }, [loadReport]);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Chuyển đổi PDF"
        meta={<span className="numeric">{jobs.length} tệp</span>}
        actions={
          <Button
            onClick={() => setDialogOpen(true)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-action px-5 text-control font-semibold text-on-action transition-colors duration-fast hover:bg-action-hover"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Chuyển đổi PDF
          </Button>
        }
      />

      {jobs.length === 0 ? (
        <EmptyState
          icon={FileOutput}
          title="Chưa có tệp chuyển đổi"
          description="Tải lên tệp PDF (scan hoặc bản số) để chuyển thành văn bản Word chuẩn Nghị định 30."
          action={
            <Button variant="secondary" onClick={() => setDialogOpen(true)}>
              Chọn tệp PDF
            </Button>
          }
        />
      ) : (
        <ul className="flex flex-col gap-4">
          {jobs.map((job) => {
            const status = statusOf(job);
            const terminal = isTerminal(status);
            const progress = Math.round((job.status?.progress ?? 0) * 100);
            const confidence = job.status?.confidence;
            const degraded = job.status?.degradedPages ?? [];
            const done = status === "completed" || status === "completed_with_warnings";
            return (
              <li
                key={job.jobId}
                className="rounded-panel border border-hairline bg-surface p-4"
                data-testid={`convert-job-${job.jobId}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 flex-shrink-0 text-text-secondary" aria-hidden="true" />
                    <span className="truncate text-control font-medium text-text-primary">
                      {job.filename}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={
                        "rounded-pill px-2.5 py-0.5 text-metadata font-medium " +
                        (status === "failed"
                          ? "bg-danger/10 text-danger"
                          : done
                            ? "bg-success/10 text-success"
                            : "bg-action/10 text-action")
                      }
                    >
                      {STATUS_LABELS[status] ?? status}
                    </span>
                    {done && (
                      <a
                        href={conversionResultUrl(job.jobId)}
                        download
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-action px-3 text-control font-semibold text-on-action hover:bg-action-hover"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Tải DOCX
                      </a>
                    )}
                  </div>
                </div>

                {!terminal && (
                  <div className="mt-3">
                    <div className="h-1.5 w-full overflow-hidden rounded-pill bg-surface-strong">
                      <div
                        className="h-full rounded-pill bg-action transition-all duration-standard"
                        style={{ width: `${Math.max(progress, 5)}%` }}
                        role="progressbar"
                        aria-valuenow={progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Tiến độ chuyển đổi ${job.filename}`}
                      />
                    </div>
                    <p className="mt-1 text-metadata text-text-secondary">{progress}%</p>
                  </div>
                )}

                {done && typeof confidence === "number" && (
                  <p className="mt-2 text-metadata text-text-secondary">
                    Độ tin cậy: {(confidence * 100).toFixed(0)}%
                    {degraded.length > 0 && (
                      <span className="ml-2 inline-flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        Trang cần kiểm tra: {degraded.join(", ")}
                      </span>
                    )}
                  </p>
                )}

                {status === "failed" && job.error && (
                  <p role="alert" className="mt-2 text-metadata text-danger">{job.error}</p>
                )}

                {/* Confidence-flag review (P4): flags surfaced, never silent */}
                {(status === "completed" || status === "completed_with_warnings") && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => toggleReport(job.jobId)}
                      className="inline-flex min-h-8 items-center gap-1.5 rounded-control bg-surface-strong px-3 text-control font-medium text-text-secondary hover:bg-surface hover:text-text-primary"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      {job.reportOpen ? "Ẩn kết quả kiểm tra" : "Xem kết quả kiểm tra độ tin cậy"}
                    </button>

                    {job.reportOpen && (
                      <div
                        className="mt-2 rounded-control border border-hairline bg-surface-subtle p-3"
                        data-testid={`convert-report-${job.jobId}`}
                      >
                        {job.report ? (
                          <div className="space-y-2 text-body text-text-secondary">
                            <div className="flex flex-wrap gap-3">
                              <span>
                                Độ tin cậy:{" "}
                                <strong className="text-text-primary">
                                  {((job.report.confidence ?? 0) * 100).toFixed(0)}%
                                </strong>
                              </span>
                              <span>
                                Độ bao phủ:{" "}
                                <strong className="text-text-primary">
                                  {job.report.coverage == null
                                    ? "Không có dữ liệu"
                                    : `${(job.report.coverage * 100).toFixed(0)}%`}
                                </strong>
                              </span>
                              <span>Phân loại lại (demote): <strong className="text-text-primary">{job.report.demotions}</strong></span>
                              {job.report.degradedPages.length > 0 && (
                                <span>
                                  Trang cần xem lại:{" "}
                                  <strong className="text-text-primary">{job.report.degradedPages.join(", ")}</strong>
                                </span>
                              )}
                            </div>

                            {job.report.lowConfidencePages.length > 0 && (
                              <div>
                                <p className="font-medium text-text-primary">Trang có độ tin cậy thấp (&lt; 70%):</p>
                                <ul className="list-inside list-disc">
                                  {job.report.lowConfidencePages.map((p) => (
                                    <li key={p.page}>
                                      Trang {p.page} — {((p.avg_confidence) * 100).toFixed(0)}% ({p.blocks} khối)
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {job.report.warnings.length > 0 && (
                              <div>
                                <p className="font-medium text-warning">Cảnh báo chuyển đổi:</p>
                                <ul className="list-inside list-disc space-y-1 text-text-primary">
                                  {job.report.warnings.map((warning, index) => (
                                    <li key={`${index}-${warning}`}>{warning}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {job.report.flaggedBlocks.length > 0 ? (
                              <div>
                                <p className="font-medium text-text-primary">Khối cần kiểm tra (&lt; 60%):</p>
                                <ul className="space-y-1.5">
                                  {job.report.flaggedBlocks.map((b) => (
                                    <li key={b.index} className="rounded-control bg-surface px-2 py-1.5">
                                      <span className="inline-flex items-center gap-1.5">
                                        <span className="rounded-pill bg-danger/10 px-2 py-0.5 text-metadata font-medium text-danger">
                                          {((b.confidence) * 100).toFixed(0)}%
                                        </span>
                                        <code className="text-metadata text-text-secondary">{b.type}</code>
                                        {b.page != null && (
                                          <span className="text-metadata text-text-secondary">trang {b.page}</span>
                                        )}
                                      </span>
                                      <p className="mt-1 break-words text-body text-text-primary">{b.preview || "(không có trích đoạn)"}</p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : (
                              <p className="text-success">Không có khối nào dưới ngưỡng cảnh báo.</p>
                            )}
                          </div>
                        ) : (
                          <p className="text-body text-text-secondary">Đang tải báo cáo…</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Side-by-side preview: source PDF | converted DOCX download */}
                {done && job.sourceUrl && (
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="overflow-hidden rounded-control border border-hairline">
                      <p className="border-b border-hairline bg-surface-strong px-3 py-1.5 text-metadata font-medium text-text-secondary">
                        Bản gốc (PDF)
                      </p>
                      <iframe
                        src={job.sourceUrl}
                        title={`Xem trước PDF ${job.filename}`}
                        className="h-72 w-full bg-workspace"
                      />
                    </div>
                    <div className="flex flex-col items-center justify-center gap-3 rounded-control border border-hairline bg-surface-strong p-6 text-center">
                      <FileOutput className="h-8 w-8 text-action" aria-hidden="true" />
                      <p className="text-control font-medium text-text-primary">
                        Kết quả Word (DOCX)
                      </p>
                      <p className="text-body text-text-secondary">
                        Văn bản đã chuyển đổi theo chuẩn Nghị định 30/2020/NĐ-CP.
                      </p>
                      <a
                        href={conversionResultUrl(job.jobId)}
                        download
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-action px-4 text-control font-semibold text-on-action hover:bg-action-hover"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                        Tải xuống
                      </a>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <ConvertUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmitted={handleSubmitted}
      />
    </div>
  );
}
