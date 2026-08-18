"use client";

import React, { useMemo } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";

const DiffEditor = dynamic(
  () => import("@monaco-editor/react").then((mod) => mod.DiffEditor),
  { ssr: false }
);

interface DocumentDiffViewerProps {
  originalContent: string;
  modifiedContent: string;
  theme?: "light" | "dark";
  height?: string;
  onAcceptDiff?: () => void;
  onRejectDiff?: () => void;
  showActions?: boolean;
}

export default function DocumentDiffViewer({
  originalContent,
  modifiedContent,
  theme = "light",
  height = "500px",
  onAcceptDiff,
  onRejectDiff,
  showActions = true,
}: DocumentDiffViewerProps) {
  const hasChanges = useMemo(
    () => originalContent !== modifiedContent,
    [originalContent, modifiedContent]
  );

  return (
    <div className="w-full rounded-panel bg-surface-strong overflow-hidden flex flex-col">
      {/* Header */}
      <div className="rounded-panel bg-surface-strong border-b border-hairline px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-control font-semibold text-text-primary">
              So sánh văn bản
            </h3>
            <p className="text-metadata text-text-muted mt-1">
              Original vs Edited — Hiển thị các thay đổi
            </p>
          </div>

          {showActions && (
            <div className="flex items-center gap-2">
              {hasChanges ? (
                <>
                  <Button onClick={onAcceptDiff} size="sm" className="flex items-center gap-1.5">
                    <span>✓</span>
                    <span>Chấp nhận</span>
                  </Button>
                  <Button onClick={onRejectDiff} variant="secondary" size="sm" className="flex items-center gap-1.5">
                    <span>✕</span>
                    <span>Hủy bỏ</span>
                  </Button>
                </>
              ) : (
                <span className="text-metadata text-text-muted">
                  Không có thay đổi
                </span>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-metadata">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-success/20 border border-success/30 rounded-pill" />
            <span className="text-text-muted">Thêm</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-error/20 border border-error/30 rounded-pill" />
            <span className="text-text-muted">Xóa</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-warning/20 border border-warning/30 rounded-pill" />
            <span className="text-text-muted">Sửa</span>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="bg-canvas flex-1" style={{ height }}>
        <DiffEditor
          original={originalContent}
          modified={modifiedContent}
          language="vndocument"
          theme={theme === "light" ? "vs" : "vs-dark"}
          options={{
            readOnly: true,
            wordWrap: "on",
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            renderSideBySide: true,
            diffWordWrap: "off",
            diffAlgorithm: "advanced",
            automaticLayout: true,
            scrollBeyondLastLine: false,
            padding: { top: 8, bottom: 8 },
            renderMarginRevertIcon: true,
            diffCodeLens: true,
          }}
        />
      </div>

      {/* Footer */}
      <div className="rounded-panel bg-surface-strong border-t border-hairline px-4 py-2">
        <div className="flex items-center justify-between text-metadata text-text-muted">
          <div className="flex items-center gap-4">
            <span>Original: {originalContent.length.toLocaleString()} ký tự</span>
            <span>Modified: {modifiedContent.length.toLocaleString()} ký tự</span>
          </div>
          {hasChanges && (
            <span className="text-action font-medium">
              ● Có {countChanges(originalContent, modifiedContent)} thay đổi
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function countChanges(original: string, modified: string): number {
  const originalWords = original.trim().split(/\s+/).filter((w) => w);
  const modifiedWords = modified.trim().split(/\s+/).filter((w) => w);
  let changes = 0;
  const maxLen = Math.max(originalWords.length, modifiedWords.length);
  for (let i = 0; i < maxLen; i++) {
    if (originalWords[i] !== modifiedWords[i]) changes++;
  }
  return changes;
}
