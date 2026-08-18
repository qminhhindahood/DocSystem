"use client";

import React, { useEffect, useRef, useCallback, useState } from "react";
import * as monaco from "monaco-editor";
import Editor, { useMonaco } from "@monaco-editor/react";
import type { DocumentTypeId } from '@/lib/document-types';

interface DocumentEditorProps {
  initialValue?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onStreamingUpdate?: (delta: string) => void;
  isStreaming?: boolean;
  documentType?: DocumentTypeId;
  onEditFeedback?: (original: string, edited: string) => void;
  height?: string;
  theme?: "light" | "dark";
}

import {
  DOCUMENT_TEMPLATES,
  VIETNAMESE_COMPLETIONS,
  vietnameseDocumentLanguage,
} from "@/lib/constants/editor";

export default function DocumentEditor({
  initialValue = "",
  readOnly = false,
  onChange,
  onStreamingUpdate,
  isStreaming = false,
  documentType,
  onEditFeedback,
  height = "600px",
  theme = "light",
}: DocumentEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const wordWrapRef = useRef<"on" | "off">("on");
  const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useMonaco();
  const [originalValue, setOriginalValue] = useState(initialValue);

  useEffect(() => {
    if (!monacoRef) return;
    if (!monacoRef.languages.getLanguages().some((l) => l.id === "vndocument")) {
      monacoRef.languages.register(vietnameseDocumentLanguage);
      monacoRef.languages.setMonarchTokensProvider("vndocument", {
        tokenizer: {
          root: [
            [/(Điều|Khoản|Điểm)\s*\d+/i, "keyword", "clause"],
            [/(CỘNG HÒA|Độc lập|Tự do|Hạnh phúc)/i, "title"],
            [/(QUYẾT ĐỊNH|CHỈ THỊ|BÁO CÁO|CÔNG VĂN)/i, "title"],
            [/(Kính gửi|Gửi):/i, "keyword"],
            [/(Căn cứ|Theo):/i, "keyword"],
            [/(\d{1,2}\/\d{2}\/\d{4})/, "number"],
            [/(Chủ tịch|Phó chủ tịch|Giám đốc|Trưởng)/i, "type"],
          ],
          clause: [[/.*/, "string", "@pop"]],
        },
      });
      monacoRef.languages.setLanguageConfiguration("vndocument", {
        brackets: [["(", ")"], ["[", "]"]],
        autoClosingPairs: [
          { open: "(", close: ")" },
          { open: "[", close: "]" },
        ],
        surroundingPairs: [
          { open: "(", close: ")" },
          { open: "[", close: "]" },
        ],
      });
    }
  }, [monacoRef]);

  useEffect(() => {
    if (!monacoRef) return;
    const disposable = monacoRef.languages.registerCompletionItemProvider("vndocument", {
      triggerCharacters: [" ", ".", ":"],
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn,
        };
        const suggestions = VIETNAMESE_COMPLETIONS.map((term) => ({
          label: term,
          kind: monacoRef.languages.CompletionItemKind.Keyword,
          insertText: term,
          detail: "Thuật ngữ hành chính",
          documentation: `Gợi ý: ${term}`,
          range,
        }));
        if (documentType) {
          suggestions.push({
            label: "insert_template",
            kind: monacoRef.languages.CompletionItemKind.Snippet,
            insertText: DOCUMENT_TEMPLATES[documentType] || "",
            detail: "Mẫu văn bản",
            documentation: "Chèn mẫu văn bản",
            range,
          });
        }
        return { suggestions };
      },
    });
    return () => disposable.dispose();
  }, [monacoRef, documentType]);

  const handleEditorMount = useCallback((editor: monaco.editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;
    setEditorInstance(editor);
    editor.updateOptions({
      wordWrap: "on",
      minimap: { enabled: true },
      fontSize: 14,
      lineNumbers: "on",
      renderLineHighlight: "all",
      automaticLayout: true,
      padding: { top: 16, bottom: 16 },
      scrollBeyondLastLine: false,
      stickyScroll: { enabled: true },
      suggest: { showKeywords: true, showSnippets: true },
      quickSuggestions: { other: true, comments: false, strings: false },
    });
    if (initialValue) editor.setValue(initialValue);
    editor.onDidChangeModelContent(() => {
      const currentValue = editor.getValue();
      if (onChange) onChange(currentValue);
      if (onEditFeedback && currentValue !== originalValue) {
        onEditFeedback(originalValue, currentValue);
      }
    });
  }, [initialValue, onChange, onEditFeedback, originalValue]);

  useEffect(() => {
    if (!editorInstance || !onStreamingUpdate) return;
    if (isStreaming) {
      editorInstance.trigger("source", "type", { text: onStreamingUpdate });
    }
  }, [editorInstance, isStreaming, onStreamingUpdate]);

  useEffect(() => {
    if (editorInstance && initialValue !== editorInstance.getValue()) {
      editorInstance.setValue(initialValue);
      setOriginalValue(initialValue);
    }
  }, [editorInstance, initialValue]);

  useEffect(() => {
    if (!editorInstance) return;
    editorInstance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyM, () => {
      const nextWrap = wordWrapRef.current === "on" ? "off" : "on";
      wordWrapRef.current = nextWrap;
      editorInstance.updateOptions({ wordWrap: nextWrap });
    });
  }, [editorInstance]);

  return (
    <div className="w-full rounded-control overflow-hidden border border-hairline" style={{ height }}>
      <Editor
        language="vndocument"
        theme={theme === "light" ? "vs" : "vs-dark"}
        value={initialValue}
        options={{
          readOnly,
          minimap: { enabled: true },
          fontSize: 14,
          lineNumbers: "on",
          renderLineHighlight: "all",
          wordWrap: "on",
          automaticLayout: true,
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          suggest: { showKeywords: true, showSnippets: true },
          quickSuggestions: true,
        }}
        onMount={handleEditorMount}
        loading={
          <div className="flex items-center justify-center h-full bg-canvas">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-pill border-2 border-transparent border-t-action"></div>
            <p className="text-text-muted text-control">Đang tải trình soạn thảo...</p>
          </div>
        }
      />
    </div>
  );
}
