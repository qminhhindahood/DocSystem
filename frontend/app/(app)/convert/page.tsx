"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Download, FileText, FileOutput, AlertTriangle, X } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ConvertUploadDialog, SubmittedJob } from "@/components/convert/ConvertUploadDialog";
import { listItem, springSoft } from "@/lib/motion";
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
  sourceFile: File | null;
  status: ConversionStatus | null;
  error: string | null;
  report: ConversionReport | null;
  reportOpen: boolean;
}

type JobUpdate = Partial<ConversionJob> | ((current: ConversionJob) => ConversionJob);

type SourcePreview = {
  jobId: string;
  filename: string;
  url: string;
};

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

/** Draw-on confidence ring; turns warning-colored below the 70% review bar. */
function ConfidenceRing({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <svg viewBox="0 0 36 36" className="h-6 w-6 -rotate-90 flex-shrink-0" aria-hidden="true">
      <circle
        cx="18"
        cy="18"
        r="15.91"
        fill="none"
        strokeWidth="4.2"
        className="stroke-surface-strong"
      />
      <motion.circle
        cx="18"
        cy="18"
        r="15.91"
        fill="none"
        strokeWidth="4.2"
        strokeLinecap="round"
        className={clamped >= 0.7 ? "stroke-success" : "stroke-warning"}
        initial={{ pathLength: 0 }}
        animate={{ pathLength: clamped }}
        transition={{ duration: 0.8, delay: 0.15, ease: [0.05, 0.7, 0.1, 1] }}
      />
    </svg>
  );
}

export default function ConvertPage() {
  const [jobs, setJobs] = useState<ConversionJob[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const jobsRef = useRef<ConversionJob[]>([]);
  const previewRef = useRef<SourcePreview | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const mutateJobs = useCallback((mutation: (current: ConversionJob[]) => ConversionJob[]) => {
    const next = mutation(jobsRef.current);
    jobsRef.current = next;
    setJobs(next);
    return next;
  }, []);

  const updateJob = useCallback((jobId: string, update: JobUpdate) => {
    mutateJobs((current) => current.map((job) => {
      if (job.jobId !== jobId) return job;
      return typeof update === "function" ? update(job) : { ...job, ...update };
    }));
  }, [mutateJobs]);

  const pollActiveJobs = useCallback(async () => {
    if (pollInFlightRef.current || !mountedRef.current) return;
    pollInFlightRef.current = true;
    try {
      const activeJobs = jobsRef.current.filter((job) => !isTerminal(statusOf(job)));
      const patches = new Map<string, Partial<ConversionJob>>();
      for (const job of activeJobs) {
        try {
          const status = await getConversionStatus(job.jobId);
          if (!mountedRef.current) return;
          patches.set(job.jobId, { status, error: status.error ?? null });
        } catch (err) {
          if (!mountedRef.current) return;
          // A transient read error does not discard the job or stop later polls.
          patches.set(job.jobId, {
            error: err instanceof Error ? err.message : "Không thể cập nhật trạng thái",
          });
        }
      }
      if (!mountedRef.current) return;
      const previous = jobsRef.current;
      const next = mutateJobs((current) => current.map((job) => ({
        ...job,
        ...patches.get(job.jobId),
      })));
      const changed = next.filter((job, index) => {
        const prior = previous[index];
        return prior === undefined
          || statusOf(job) !== statusOf(prior)
          || job.error !== prior.error;
      });
      if (changed.length > 0) {
        setAnnouncement(changed.map((job) => (
          `${job.filename}: ${STATUS_LABELS[statusOf(job)] ?? statusOf(job)}`
        )).join(". "));
      }
      if (!next.some((job) => !isTerminal(statusOf(job)))) {
        stopPolling();
      }
    } finally {
      pollInFlightRef.current = false;
    }
  }, [mutateJobs, stopPolling]);

  const startPolling = useCallback(() => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      void pollActiveJobs();
    }, POLL_INTERVAL_MS);
  }, [pollActiveJobs]);

  // Clean up the shared timer and the single active object URL on unmount.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      const activePreview = previewRef.current;
      if (activePreview) URL.revokeObjectURL(activePreview.url);
      previewRef.current = null;
    };
  }, [stopPolling]);

  const handleSubmitted = useCallback((submittedJobs: SubmittedJob[]) => {
    mutateJobs((current) => [
        ...submittedJobs.map((job) => {
          return ({
            jobId: job.jobId,
            filename: job.filename,
            sourceFile: job.file,
            status: null,
            error: null,
            report: null,
            reportOpen: false,
          });
        }),
        ...current,
      ]);
    setAnnouncement(`${submittedJobs.length} tệp đã được đưa vào hàng đợi chuyển đổi.`);
    startPolling();
  }, [mutateJobs, startPolling]);

  const closePreview = useCallback(() => {
    const activePreview = previewRef.current;
    if (activePreview) URL.revokeObjectURL(activePreview.url);
    previewRef.current = null;
    setPreview(null);
  }, []);

  const openPreview = useCallback((job: ConversionJob) => {
    if (!job.sourceFile || previewRef.current?.jobId === job.jobId) return;
    const activePreview = previewRef.current;
    if (activePreview) URL.revokeObjectURL(activePreview.url);
    const nextPreview = {
      jobId: job.jobId,
      filename: job.filename,
      url: URL.createObjectURL(job.sourceFile),
    };
    previewRef.current = nextPreview;
    setPreview(nextPreview);
  }, []);

  const loadReport = useCallback(async (jobId: string) => {
    try {
      const report = await getConversionReport(jobId);
      updateJob(jobId, { report });
    } catch {
      updateJob(jobId, { report: null });
    }
  }, [updateJob]);

  const toggleReport = useCallback((jobId: string) => {
    const current = jobsRef.current.find((job) => job.jobId === jobId);
    if (current && !current.report) void loadReport(jobId);
    updateJob(jobId, (job) => ({ ...job, reportOpen: !job.reportOpen }));
  }, [loadReport, updateJob]);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
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
          <AnimatePresence initial={false}>
            {jobs.map((job) => {
              const status = statusOf(job);
              const terminal = isTerminal(status);
              const progress = Math.round((job.status?.progress ?? 0) * 100);
              const confidence = job.status?.confidence;
              const degraded = job.status?.degradedPages ?? [];
              const done = status === "completed" || status === "completed_with_warnings";
              return (
                <motion.li
                  key={job.jobId}
                  layout
                  variants={listItem}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
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
                            ? "bg-error-surface text-error"
                            : done
                              ? "bg-success-surface text-success"
                              : "bg-action-tint text-action")
                        }
                      >
                        {done && (
                          <span className="check-draw mr-1 inline-flex h-3 w-3 items-center justify-center align-[-2px]" aria-hidden="true">
                            <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
                              <path
                                d="M3 8.5L6.5 12L13 4.5"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                pathLength={1}
                              />
                            </svg>
                          </span>
                        )}
                        {STATUS_LABELS[status] ?? status}
                      </span>
                    {done && (
                      <a
                        href={conversionResultUrl(job.jobId)}
                        download
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-action px-3 text-control font-semibold text-on-action hover:bg-action-hover"
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
                      <motion.div
                        className="h-full w-full origin-left rounded-pill bg-action"
                        initial={{ scaleX: 0.05 }}
                        animate={{ scaleX: Math.max(progress, 5) / 100 }}
                        transition={springSoft}
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
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-metadata text-text-secondary">
                    <ConfidenceRing value={confidence} />
                    <span>
                      Độ tin cậy: {(confidence * 100).toFixed(0)}%
                    </span>
                    {degraded.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        Trang cần kiểm tra: {degraded.join(", ")}
                      </span>
                    )}
                  </div>
                )}

                {status === "failed" && job.error && (
                  <p role="alert" className="mt-2 text-metadata text-error">{job.error}</p>
                )}

                {/* Confidence-flag review (P4): flags surfaced, never silent */}
                {(status === "completed" || status === "completed_with_warnings") && (
                  <div className="mt-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => toggleReport(job.jobId)}
                        className="inline-flex min-h-11 items-center gap-1.5 rounded-control bg-surface-strong px-3 text-control font-medium text-text-secondary hover:bg-surface hover:text-text-primary"
                      >
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                        {job.reportOpen ? "Ẩn kết quả kiểm tra" : "Xem kết quả kiểm tra độ tin cậy"}
                      </button>
                      {job.sourceFile && (
                        <button
                          type="button"
                          onClick={() => openPreview(job)}
                          className="inline-flex min-h-11 items-center gap-1.5 rounded-control border border-hairline bg-surface px-3 text-control font-medium text-text-secondary hover:bg-surface-strong hover:text-text-primary"
                        >
                          <FileText className="h-4 w-4" aria-hidden="true" />
                          Xem PDF gốc
                        </button>
                      )}
                    </div>

                    {job.reportOpen && (
                      <motion.div
                        key="report"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.28, ease: [0.05, 0.7, 0.1, 1] }}
                        className="overflow-hidden"
                      >
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
                                        <span className="rounded-pill bg-error-surface px-2 py-0.5 text-metadata font-medium text-error">
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
                      </motion.div>
                    )}
                  </div>
                )}

                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {preview && (
          <section
            className="overflow-hidden rounded-panel border border-hairline bg-surface"
            aria-label={`PDF gốc ${preview.filename}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline bg-surface-strong px-4 py-3">
              <h2 className="min-w-0 break-words text-section-title text-text-primary">
                PDF gốc: {preview.filename}
              </h2>
              <button
                type="button"
                onClick={closePreview}
                className="inline-flex min-h-11 items-center gap-2 rounded-control px-3 text-control font-medium text-text-secondary hover:bg-surface hover:text-text-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
                Đóng bản xem trước
              </button>
            </div>
            <iframe
              src={preview.url}
              title={`PDF gốc: ${preview.filename}`}
              loading="lazy"
              className="h-[min(70dvh,720px)] w-full bg-workspace"
            />
          </section>
      )}

      <ConvertUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmitted={handleSubmitted}
      />
    </div>
  );
}
