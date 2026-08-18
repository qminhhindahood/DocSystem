"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTheme } from '@/lib/theme';
import { formatDocumentType, type DocumentTypeId } from '@/lib/document-types';

// Dynamically import Monaco editor to avoid SSR issues
const DocumentEditor = dynamic(() => import("./DocumentEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-96 bg-canvas">
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-pill border-2 border-transparent border-t-action"></div>
        <p className="text-text-muted">Đang tải trình soạn thảo...</p>
      </div>
    </div>
  ),
});

interface StreamingDocumentEditorProps {
  /** Initial document content or empty string */
  initialValue?: string;
  /** Whether content is currently being streamed from AI */
  isStreaming: boolean;
  /** True only after an explicit terminal event from the active request */
  generationComplete?: boolean;
  /** AI-generated content chunk (for streaming) */
  streamingChunk?: string;
  /** Callback when user edits the document */
  onUserEdit?: (value: string) => void;
  /** Callback to cancel generation */
  onCancelGeneration?: () => void;
  /** Callback to accept/reject AI suggestions */
  onAcceptSuggestion?: (value: string) => void;
  /** Callback for edit feedback */
  onEditFeedback?: (original: string, edited: string) => void;
  /** Document type for template suggestions */
  documentType?: DocumentTypeId;
  /** Read-only during streaming */
  readOnlyDuringStreaming?: boolean;
  /** Prompt for generation */
  prompt?: string;
  /** Callback for streaming stage updates */
  onStreamingStage?: (stage: string) => void;
  /** Show floating toolbar with accept/reject when complete */
  floatingToolbar?: boolean;
}

/**
 * StreamingDocumentEditor Component
 *
 * Enhanced editor with real-time streaming support for AI-generated documents.
 * Features:
 * - Real-time content streaming as AI generates
 * - User can edit while streaming (with optional read-only mode)
 * - Accept/reject suggestions functionality
 * - Change highlighting for tracked modifications
 * - Feedback capture for self-learning loop
 */
export default function StreamingDocumentEditor({
  initialValue = "",
  isStreaming = false,
  generationComplete = false,
  onUserEdit,
  onCancelGeneration,
  onAcceptSuggestion,
  onEditFeedback,
  documentType,
  readOnlyDuringStreaming = true,
  onStreamingStage,
  floatingToolbar = false,
}: StreamingDocumentEditorProps) {
  const { theme } = useTheme();
  const [content, setContent] = useState(initialValue);
  const [hasChanges, setHasChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentStage = '';
  const feedbackTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Handle content changes
  const handleChange = useCallback(
    (value: string) => {
      setContent(value);
      setHasChanges(true);
      if (onUserEdit) {
        onUserEdit(value);
      }
    },
    [onUserEdit],
  );

  // Handle edit feedback for self-learning with 2000ms debounce
  const handleEditFeedback = useCallback(
    (original: string, edited: string) => {
      if (original === edited || !onEditFeedback) return;

      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }

      feedbackTimeoutRef.current = setTimeout(() => {
        onEditFeedback(original, edited);
      }, 2000);
    },
    [onEditFeedback],
  );

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  // Accept suggestion (finalize streaming)
  const handleAcceptSuggestion = useCallback(() => {
    if (onAcceptSuggestion) {
      onAcceptSuggestion(content);
    }
  }, [content, onAcceptSuggestion]);

  // Cancel generation
  const handleCancel = useCallback(() => {
    if (onCancelGeneration) {
      onCancelGeneration();
    }
    setError(null);
  }, [onCancelGeneration]);

  // Reset editor state
  const handleReset = useCallback(() => {
    setContent(initialValue);
    setHasChanges(false);
    setError(null);
  }, [initialValue]);

  // Handle streaming stage updates
  useEffect(() => {
    if (currentStage && onStreamingStage) {
      onStreamingStage(currentStage);
    }
  }, [currentStage, onStreamingStage]);

  // Sync content with initialValue prop, but skip during active streaming
  // to prevent flicker from parent re-rendering on each chunk
  useEffect(() => {
    if (!isStreaming || !initialValue) {
      setContent(initialValue);
    }
  }, [initialValue, isStreaming]);

  return (
    <div className="flex w-full flex-col overflow-hidden rounded-panel bg-surface-strong">
      {/* Editor Header */}
      <div className="border-b border-hairline bg-surface-strong px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* Status indicator */}
            <div className="flex items-center gap-2">
              {isStreaming ? (
                <>
                  <div className="h-3 w-3 animate-pulse rounded-pill bg-success"></div>
                  <span className="text-control font-medium text-success">
                    {currentStage ? formatStage(currentStage) : 'Đang tạo nội dung...'}
                  </span>
                </>
              ) : generationComplete ? (
                <>
                  <div className="h-3 w-3 rounded-pill bg-action"></div>
                  <span className="text-control font-medium text-action">Hoàn thành</span>
                </>
              ) : (
                <>
                  <div className="h-3 w-3 rounded-pill bg-surface-strong"></div>
                  <span className="text-control font-medium text-text-muted">Sẵn sàng</span>
                </>
              )}
            </div>

            {/* Document type badge */}
            {documentType && (
              <span className="text-metadata px-2 py-1 bg-action/10 text-action rounded-compact font-medium">
                {formatDocumentType(documentType)}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {hasChanges && (
              <span className="text-metadata text-warning font-medium">Đã sửa</span>
            )}

            {error && <span className="text-metadata text-error font-medium">{error}</span>}

            {isStreaming && onCancelGeneration && (
              <button
                onClick={handleCancel}
                className="px-3 py-1.5 text-control bg-error text-on-action rounded-control hover:opacity-90 transition-opacity"
              >
                Hủy
              </button>
            )}

            {generationComplete && onAcceptSuggestion && (
              <button
                onClick={handleAcceptSuggestion}
                className="px-3 py-1.5 text-control bg-success text-on-action rounded-control hover:opacity-90 transition-opacity"
              >
                Chấp nhận
              </button>
            )}

            {hasChanges && (
              <button
                onClick={handleReset}
                className="px-3 py-1.5 text-control bg-surface-strong border border-hairline text-text-primary rounded-control hover:bg-surface-strong transition-colors"
              >
                Đặt lại
              </button>
            )}
          </div>
        </div>

        {/* Progress bar (only during streaming) */}
        {isStreaming && (
          <div className="mt-3">
            <div className="h-1 bg-surface-strong rounded-pill overflow-hidden">
              <div className="h-full w-full animate-pulse bg-action"></div>
            </div>
          </div>
        )}
      </div>

      {/* Editor Content */}
      <div className="p-4 bg-canvas relative flex-1">
        <DocumentEditor
          initialValue={content}
          onChange={handleChange}
          onEditFeedback={handleEditFeedback}
          documentType={documentType}
          isStreaming={isStreaming}
          readOnly={isStreaming && readOnlyDuringStreaming}
          height="600px"
          theme={theme}
        />

        {/* Floating Toolbar */}
        {floatingToolbar && generationComplete && onAcceptSuggestion && (
          <div className="bg-surface absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-panel border border-hairline px-3 py-2 shadow-floating">
            <button
              onClick={handleAcceptSuggestion}
              className="flex min-h-10 items-center gap-2 rounded-control bg-success px-4 text-body font-medium text-on-action transition-opacity hover:opacity-90"
            >
              ✓ Chấp nhận
            </button>
            <button
              onClick={handleReset}
              className="flex min-h-10 items-center gap-2 rounded-control border border-hairline bg-surface-strong px-4 text-body font-medium text-text-primary transition-colors hover:bg-surface-strong"
            >
              ✕ Từ chối
            </button>
          </div>
        )}
      </div>

      {/* Footer with stats */}
      <div className="border-t border-hairline bg-surface-strong px-4 py-2">
        <div className="flex items-center justify-between text-metadata text-text-muted">
          <div className="flex items-center gap-4">
            <span>{content.length.toLocaleString()} ký tự</span>
            <span>{countWords(content)} từ</span>
            <span>{countLines(content)} dòng</span>
          </div>
          {isStreaming && (
            <span className="text-success font-medium">● Đang stream từ AI</span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatStage(stage: string): string {
  const stageMap: Record<string, string> = {
    planning: "Đang lập kế hoạch...",
    researching: "Đang thu thập thông tin...",
    writing: "Đang soạn thảo...",
    complete: "Hoàn thành",
  };
  return stageMap[stage] || stage;
}

function countWords(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function countLines(text: string): number {
  return text.split("\n").length;
}
