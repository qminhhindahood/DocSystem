"use client";

import React, { useState, useRef, useEffect } from "react";
import { askQuestion, QAMessage, QASource } from "@/lib/api";
import {
  Send,
  RotateCcw,
  BookOpen,
  Copy,
  Check,
  Trash2,
  Square,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/components/lib/cn';
import { DOCUMENT_TYPE_OPTIONS } from '@/lib/document-types';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineAlert } from '@/components/ui/inline-alert';

const DOC_TYPE_OPTIONS = [
  { value: '', label: 'Tất cả loại văn bản' },
  ...DOCUMENT_TYPE_OPTIONS,
];

export default function QAPage() {
  const { toast } = useToast();
  const [messages, setMessages] = useState<QAMessage[]>([]);
  const [question, setQuestion] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [docType, setDocType] = useState<string>('');
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const [currentSources, setCurrentSources] = useState<QASource[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  // Persistent failure state: a toast alone would lose the retry affordance.
  const [failure, setFailure] = useState<{ question: string; message: string } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingAnswer]);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, []);

  const handleCopy = async (text: string, msgIdx: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(msgIdx);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast({ variant: 'error', title: 'Không sao chép được', description: 'Trình duyệt không hỗ trợ clipboard.' });
    }
  };

  // Track the last user question so regenerate can re-ask it.
  const lastUserQuestion = useRef<string>('');
  const handleRegenerate = () => {
    if (isAsking || !lastUserQuestion.current) return;
    setQuestion(lastUserQuestion.current);
    // Clear the trailing assistant message before re-asking
    setMessages((prev) => {
      if (prev.at(-1)?.role === 'assistant') {
        return prev.slice(0, -1);
      }
      return prev;
    });
    setTimeout(() => handleAsk(lastUserQuestion.current), 0);
  };

  const runAsk = async (q: string) => {
    if (activeRequestRef.current) return;
    const id = ++requestIdRef.current;
    const controller = new AbortController();
    activeRequestRef.current = { id, controller };
    const { signal } = controller;
    const isCurrent = () => activeRequestRef.current?.id === id && !signal.aborted;
    const userMsg: QAMessage = {
      role: 'user',
      content: q,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsAsking(true);
    setStreamingAnswer('');
    setCurrentSources([]);
    setFailure(null);

    const assistantMsg: QAMessage = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMsg]);

    let hadError = false;
    let receivedCompletion = false;
    let accumulatedAnswer = '';
    let receivedSources: QASource[] = [];

    try {
      for await (const evt of askQuestion(q, docType || undefined, 5, signal)) {
        if (!isCurrent()) throw new DOMException('Aborted', 'AbortError');
        if (evt.event === 'done') {
          receivedCompletion = true;
          break;
        }
        const d = evt.data as Record<string, unknown>;
        if (d.error) {
          hadError = true;
          setMessages((prev) => {
            const last = prev.at(-1);
            return last
              ? [...prev.slice(0, -1), { ...last, content: '' }]
              : prev;
          });
          setFailure({ question: q, message: String(d.error) });
          toast({
            variant: 'error',
            title: 'Không trả lời được',
            description: String(d.error),
            duration: 7000,
          });
          break;
        }
        if (d.stage === 'researching' && Array.isArray(d.sources)) {
          receivedSources = d.sources as QASource[];
          setCurrentSources(receivedSources);
        }
        if (d.answerChunk) {
          const chunk = d.answerChunk as string;
          accumulatedAnswer += chunk;
          setStreamingAnswer((prev) => prev + chunk);
          setMessages((prev) => {
            const last = prev.at(-1);
            return last
              ? [...prev.slice(0, -1), { ...last, content: last.content + chunk }]
              : prev;
          });
        }
        if (d.done) {
          receivedCompletion = true;
          const answer = typeof d.answer === 'string' ? d.answer : accumulatedAnswer;
          const sources = Array.isArray(d.sources) ? d.sources as QASource[] : receivedSources;
          setMessages((prev) => {
            const last = prev.at(-1);
            return last
              ? [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    content: answer,
                    sources,
                    lowConfidence: Boolean(d.lowConfidence),
                  },
                ]
              : prev;
          });
          if (d.lowConfidence) {
            toast({ variant: 'warning', title: 'Kiểm tra lại câu trả lời', description: 'Câu trả lời có thể thiếu căn cứ từ tài liệu.' });
          }
          setStreamingAnswer('');
          break;
        }
      }
      if (hadError) return;
      if (!receivedCompletion) {
        throw new Error('Luồng trả lời kết thúc mà không có sự kiện hoàn tất');
      }
    } catch (err) {
      const aborted = signal.aborted || (err instanceof Error && err.name === 'AbortError');
      hadError = true;
      if (!aborted && activeRequestRef.current?.id === id) {
        const msg = err instanceof Error ? err.message : 'Không xác định';
        setMessages((prev) => {
          const last = prev.at(-1);
          return last
            ? [...prev.slice(0, -1), { ...last, content: '' }]
            : prev;
        });
        setFailure({ question: q, message: msg });
        toast({
          variant: 'error',
          title: 'Lỗi kết nối',
          description: msg,
          duration: 7000,
        });
      }
    } finally {
      if (activeRequestRef.current?.id !== id) return;
      activeRequestRef.current = null;
      setIsAsking(false);
      setStreamingAnswer('');
      // If the assistant bubble is empty after an error, drop it so the
      // transcript isn't left with a blank message.
      if (hadError) {
        setMessages((prev) => {
          const last = prev.at(-1);
          if (last?.role === 'assistant' && !last.content) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    }
  };

  const handleAsk = (override?: string) => {
    const q = (override ?? question).trim();
    if (!q || activeRequestRef.current) return;
    lastUserQuestion.current = q;
    setQuestion('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    runAsk(q);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  const clearChat = () => {
    activeRequestRef.current?.controller.abort();
    setMessages([]);
    setCurrentSources([]);
    setStreamingAnswer('');
    setFailure(null);
    lastUserQuestion.current = '';
  };

  const handleCancel = () => {
    activeRequestRef.current?.controller.abort();
  };

  const lastAssistantIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'assistant') return i;
    }
    return -1;
  })();

  // Sources belong to the newest answer; during streaming they arrive first.
  const lastAssistant = lastAssistantIdx >= 0 ? messages[lastAssistantIdx] : undefined;
  const displayedSources = lastAssistant?.sources ?? currentSources;
  const hasAnswer = Boolean(lastAssistant?.content) || Boolean(streamingAnswer);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Tra cứu văn bản"
        description="Đặt câu hỏi về tài liệu đã tải lên."
        actions={
          messages.length > 0 && (
            <Button variant="secondary" size="lg" className="gap-1.5" onClick={clearChat}>
              <Trash2 aria-hidden="true" className="h-4 w-4" />
              Xóa hội thoại
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Primary reading surface: the answer. */}
        <div className="flex flex-col gap-4 lg:col-span-8">
          <div
            role="log"
            aria-label="Câu trả lời"
            aria-live="polite"
            className="flex-1 space-y-3"
          >
            {messages.length === 0 ? (
              <EmptyState
                title="Bắt đầu đặt câu hỏi"
                description="Nhập câu hỏi về nội dung văn bản hành chính. Hệ thống tìm các đoạn liên quan trong tài liệu đã tải lên và trả lời dựa trên văn bản đó."
                icon={BookOpen}
              />
            ) : (
              messages.map((msg, idx) => (
                <div
                  key={idx}
                  className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[85%] rounded-control px-4 py-3',
                      msg.role === 'user'
                        ? 'bg-action text-on-action'
                        : 'border border-hairline bg-surface text-text-primary',
                    )}
                  >
                    <p className="whitespace-pre-wrap text-body">{msg.content}</p>

                    {/* Low confidence stays on screen rather than only in a toast. */}
                    {msg.lowConfidence && (
                      <p className="mt-2 text-metadata text-warning">
                        Câu trả lời có thể thiếu căn cứ từ tài liệu. Hãy kiểm tra lại nguồn.
                      </p>
                    )}

                    <div
                      className={cn(
                        'mt-2 flex items-center gap-3 text-metadata',
                        msg.role === 'user' ? 'text-on-action' : 'text-text-muted',
                      )}
                    >
                      <button
                        onClick={() => handleCopy(msg.content, idx)}
                        className="inline-flex items-center gap-1 transition-opacity hover:opacity-80"
                      >
                        {copiedId === idx ? (
                          <Check aria-hidden="true" className="h-3 w-3" />
                        ) : (
                          <Copy aria-hidden="true" className="h-3 w-3" />
                        )}
                        {copiedId === idx ? 'Đã sao chép' : 'Sao chép'}
                      </button>
                      {idx === lastAssistantIdx && (
                        <button
                          onClick={handleRegenerate}
                          disabled={isAsking}
                          className={cn(
                            'inline-flex items-center gap-1 transition-opacity hover:opacity-80',
                            isAsking && 'cursor-not-allowed opacity-50',
                          )}
                        >
                          <RotateCcw aria-hidden="true" className="h-3 w-3" />
                          Làm mới
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
            {/* Failure stays visible with a specific retry action. */}
            {failure && (
              <InlineAlert
                variant="error"
                title="Không trả lời được"
                action={
                  <Button
                    size="sm"
                    disabled={isAsking}
                    onClick={() => handleAsk(failure.question)}
                  >
                    Thử lại
                  </Button>
                }
              >
                {failure.message}
              </InlineAlert>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer stays in flow so it never obscures the answer. */}
          <div className="space-y-3 rounded-panel border border-hairline bg-surface p-3">
            <div className="flex items-center gap-3">
              <span className="whitespace-nowrap text-metadata text-text-muted">
                Lọc theo loại:
              </span>
              <Select
                size="md"
                ariaLabel="Lọc theo loại văn bản"
                value={docType}
                onValueChange={(val) => setDocType(val)}
                options={DOC_TYPE_OPTIONS}
                className="max-w-[240px]"
              />
            </div>
            <div className="flex items-end gap-2">
              <label htmlFor="qa-question" className="sr-only">
                Câu hỏi
              </label>
              <textarea
                id="qa-question"
                ref={textareaRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Nhập câu hỏi về văn bản hành chính... (Enter để gửi, Shift+Enter xuống dòng)"
                rows={1}
                disabled={isAsking}
                className="control-field flex-1 resize-none text-body"
                style={{ minHeight: '48px', maxHeight: '120px' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
                }}
              />
              {isAsking ? (
                <Button
                  onClick={handleCancel}
                  variant="destructive"
                  size="lg"
                  className="w-12 px-0"
                  aria-label="Hủy câu hỏi"
                >
                  <Square aria-hidden="true" className="h-5 w-5" />
                </Button>
              ) : (
                <Button
                  onClick={() => handleAsk()}
                  disabled={!question.trim()}
                  size="lg"
                  className="w-12 px-0"
                  aria-label="Gửi câu hỏi"
                >
                  <Send aria-hidden="true" className="h-5 w-5" />
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Distinct secondary region: provenance for the newest answer. */}
        {hasAnswer && (
          <aside
            aria-label="Nguồn tham khảo"
            className="space-y-2 rounded-panel border border-hairline bg-surface-subtle p-4 lg:col-span-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-control font-semibold text-text-primary">Nguồn tham khảo</h2>
              {displayedSources.length > 0 && (
                <span className="text-metadata text-text-muted numeric">
                  {displayedSources.length} đoạn
                </span>
              )}
            </div>

            {displayedSources.length === 0 ? (
              <p className="text-metadata text-text-secondary">
                Không có đoạn nguồn nào cho câu trả lời này.
              </p>
            ) : (
              <ul className="space-y-2">
                {displayedSources.map((s, i) => (
                  <li
                    key={s.id || i}
                    className="rounded-control border border-hairline bg-surface p-3"
                  >
                    {/* Article and clause appear only when the source carries them. */}
                    {(s.article || s.clause) && (
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        {s.article && <Badge variant="info">{s.article}</Badge>}
                        {s.clause && <Badge variant="default">{s.clause}</Badge>}
                      </div>
                    )}
                    <p className="whitespace-pre-wrap text-metadata text-text-secondary">
                      {s.content}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
