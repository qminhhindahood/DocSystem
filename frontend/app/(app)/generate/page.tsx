"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import StreamingDocumentEditor from "@/components/StreamingDocumentEditor";
import { SourcePanel, SourceChunk } from "@/components/feature/SourcePanel";
import { ValidationPanel, ValidationResult } from "@/components/feature/ValidationPanel";
import { FeedbackPanel } from "@/components/feature/FeedbackPanel";
import { FidelityWarningPanel } from "@/components/feature/FidelityWarningPanel";
import { Button } from "@/components/ui/button";
import { Select, SelectOption } from "@/components/ui/select";
import { Upload, Loader2, FileText } from "lucide-react";
import { cn } from "@/components/lib/cn";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { GenerationStages } from "@/components/feature/GenerationStages";
import { ExportConfirmationDialog } from "@/components/documents/ExportConfirmationDialog";
import {
  isStreamStage,
  mapStreamStageToGenerationStep,
  type GenerationStep,
} from "@/lib/ui/generation-stage";
import {
  generateDocument,
  validateDocument,
  getDocumentTypes,
  getTemplateFields,
  extractFields,
  uploadPDF,
  sendEditFeedback,
  downloadDocumentAsDocx,
  DocumentType,
  DocumentField,
  FidelitySummary,
} from "@/lib/api";
import { getTemplates, type TemplateSummary } from "@/lib/templates-api";
import type { DocumentTypeId } from '@/lib/document-types';

export default function GenerationPage() {
  const activeRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const requestIdRef = useRef(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [generatedContent, setGeneratedContent] = useState('');
  const [, setOriginalContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [streamingStage, setStreamingStage] = useState('');
  const [confirmExport, setConfirmExport] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [hasEnteredExport, setHasEnteredExport] = useState(false);
  const [documentId, setDocumentId] = useState<string>();
  const [formatResult, setFormatResult] = useState<string>();
  const [formatResultName, setFormatResultName] = useState<string>();
  const [fidelity, setFidelity] = useState<FidelitySummary>();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState<DocumentTypeId | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [validationResults, setValidationResults] = useState<ValidationResult | null>(null);
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([]);
  const [fields, setFields] = useState<DocumentField[]>([]);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [showFieldForm, setShowFieldForm] = useState(false);
  const [readyTemplates, setReadyTemplates] = useState<TemplateSummary[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // Sources from RAG (mock - would come from generation response)
  const [sources, setSources] = useState<SourceChunk[]>([]);

  // Load document types on mount
  useEffect(() => {
    getDocumentTypes()
      .then(setDocumentTypes)
      .catch(console.error);
  }, []);

  useEffect(() => {
    getTemplates()
      .then(result => setReadyTemplates(result.templates.filter(template => template.status === 'READY')))
      .catch(err => setError(err instanceof Error ? err.message : 'Không thể tải mẫu DOCX'));
  }, []);

  // Load template fields whenever documentType changes
  useEffect(() => {
    if (!documentType) {
      setFields([]);
      setFieldValues({});
      return;
    }
    getTemplateFields(documentType)
      .then((res) => {
        setFields(res.fields);
        const seeded: Record<string, string> = {};
        for (const f of res.fields) {
          seeded[f.name] = f.defaultValue || '';
        }
        setFieldValues(seeded);
      })
      .catch((err) => console.error('Failed to load fields:', err));
  }, [documentType]);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, []);

  const handleExtractFields = useCallback(async () => {
    if (!prompt.trim() || !documentType) return;
    setIsExtracting(true);
    try {
      const res = await extractFields(prompt, documentType);
      setFieldValues((prev) => ({ ...prev, ...res.fields }));
      setShowFieldForm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trích xuất trường thất bại');
    } finally {
      setIsExtracting(false);
    }
  }, [prompt, documentType]);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleGenerate = useCallback(async () => {
		if (activeRequestRef.current) return;
		if (!prompt.trim()) {
			setError('Vui lòng nhập nội dung yêu cầu');
			return;
		}

		if (selectedFile && !documentType) {
			setError('Vui lòng chọn loại văn bản trước khi upload tài liệu');
			return;
		}

		const id = ++requestIdRef.current;
		const controller = new AbortController();
		const { signal } = controller;
		activeRequestRef.current = { id, controller };
		const isCurrent = () => activeRequestRef.current?.id === id && !signal.aborted;

		setIsGenerating(true);
		setIsComplete(false);
		setGeneratedContent('');
		setError(null);
		setStreamingStage('');
		setHasEnteredExport(false);
		setValidationResults(null);
		setFidelity(undefined);
		setSources([]); // Reset sources
		setDocumentId(undefined);
		setFormatResult(undefined);
		setFormatResultName(undefined);

		try {
			const referenceDocumentId = selectedFile && documentType
				? await uploadPDF(selectedFile, documentType, signal)
				: undefined;
			if (!isCurrent()) throw new DOMException('Aborted', 'AbortError');

			const fieldSummary = Object.entries(fieldValues)
				.filter(([, v]) => v && v.trim())
				.map(([k, v]) => `${k}: ${v}`)
				.join(' | ');
			const enrichedPrompt = fieldSummary
				? `${prompt.trim()}\n\nThông tin bổ sung: ${fieldSummary}`
				: prompt.trim();

			const request = {
				prompt: enrichedPrompt,
				docType: documentType,
				templateId: selectedTemplateId || undefined,
				referenceDocumentIds: referenceDocumentId ? [referenceDocumentId] : undefined,
			};

			let accumulatedContent = '';
			let receivedCompletion = false;

			for await (const chunk of generateDocument(request, signal)) {
				if (!isCurrent()) throw new DOMException('Aborted', 'AbortError');

				if (chunk.error) {
					throw new Error(chunk.error);
				}

				if (chunk.stage) {
					setStreamingStage(chunk.stage);
				}

				if (chunk.chunk) {
					accumulatedContent += chunk.chunk;
					setGeneratedContent(accumulatedContent);
				}

				if (chunk.sources) {
					setSources(chunk.sources as SourceChunk[]);
				}

				if (chunk.done) {
					receivedCompletion = true;
					if (chunk.documentId) {
						setDocumentId(chunk.documentId);
					}
					if (chunk.formatResult) {
						setFormatResult(chunk.formatResult);
						setFormatResultName(chunk.formatResultName);
					}
					if (chunk.fidelity) setFidelity(chunk.fidelity);
					break;
				}
			}

			if (!receivedCompletion) {
				throw new Error('Luồng tạo văn bản kết thúc mà không có sự kiện hoàn tất');
			}
			if (!isCurrent()) throw new DOMException('Aborted', 'AbortError');
			setIsComplete(true);
			setOriginalContent(accumulatedContent);
		} catch (err) {
			const aborted = signal.aborted || (err instanceof Error && err.name === 'AbortError');
			if (activeRequestRef.current?.id === id && !aborted) {
				setError(err instanceof Error ? err.message : 'Đã xảy ra lỗi');
			}
		} finally {
			if (activeRequestRef.current?.id === id) {
				activeRequestRef.current = null;
				setIsGenerating(false);
			}
		}
	}, [prompt, documentType, selectedFile, fieldValues, selectedTemplateId]);

  const handleCancelGeneration = useCallback(() => {
    activeRequestRef.current?.controller.abort();
  }, []);

  const handleUserEdit = useCallback((value: string) => {
    setGeneratedContent(value);
  }, []);

  const handleEditFeedback = useCallback(
    (original: string, edited: string) => {
      if (!documentType) return;
      sendEditFeedback({
        originalContent: original,
        editedContent: edited,
        docType: documentType,
      }).catch(console.error);
    },
    [documentType],
  );

  const handleValidate = useCallback(async () => {
    if (!generatedContent || !documentType) return;
    try {
      const results = await validateDocument(generatedContent, documentType);
      setValidationResults(results);
    } catch (error) {
      console.error('Validation error:', error);
    }
  }, [generatedContent, documentType]);

  const handleExportDocx = useCallback(async () => {
    setIsExporting(true);
    try {
      if (documentId) {
        // Template path: fetch verified DOCX from server
        await downloadDocumentAsDocx(
          documentId,
          `Van_ban_${new Date().toISOString().slice(0, 10)}`
        );
      } else if (formatResult) {
        // Non-template streaming path: download inline base64 DOCX directly
        const byteChars = atob(formatResult);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = formatResultName || `Van_ban_${new Date().toISOString().slice(0, 10)}.docx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        throw new Error('Chưa có tệp DOCX để tải');
      }
    } catch (error) {
      setError(
        `Xuất DOCX thất bại: ${error instanceof Error ? error.message : 'Lỗi không xác định'}`,
      );
      // Rethrow so the confirmation dialog stays open and reports in place.
      throw error;
    } finally {
      setIsExporting(false);
    }
  }, [documentId, formatResult, formatResultName]);

  // Presentation only: the SSE contract is unchanged.
  const currentStep: GenerationStep = hasEnteredExport
    ? 'export'
    : isStreamStage(streamingStage)
      ? mapStreamStageToGenerationStep(streamingStage)
      : 'setup';

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader
        title="Tạo văn bản"
        description="Tạo văn bản hành chính tuân thủ Nghị định 30/2020/NĐ-CP."
      />

      <GenerationStages current={currentStep} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Setup panel */}
        <div className="space-y-4 lg:col-span-4 xl:col-span-3">
            <div className="space-y-4 rounded-panel border border-hairline bg-surface p-4">
              {/* Document Type Selection */}
              <div>
                <h2 className="mb-2 text-control text-text-secondary">
                  Loại văn bản
                </h2>
                <Select
                  value={documentType || ''}
                  onValueChange={(val) =>
                    setDocumentType((val || undefined) as DocumentTypeId | undefined)
                  }
                  options={[
                    { value: '', label: '-- Chọn loại văn bản --' },
                    ...documentTypes.map((type): SelectOption => ({
                      value: type.id,
                      label: type.name,
                    })),
                  ]}
                  placeholder="Chọn loại văn bản"
                  className="w-full"
                />
              </div>

              <div>
                <h2 className="mb-2 text-control text-text-secondary">
                  Mẫu DOCX tùy chọn
                </h2>
                <Select
                  value={selectedTemplateId}
                  onValueChange={(value) => {
                    setSelectedTemplateId(value);
                    const selected = readyTemplates.find(template => template.id === value);
                    if (selected?.docType) setDocumentType(selected.docType as typeof documentType);
                  }}
                  options={[
                    { value: '', label: '-- Dùng mẫu chuẩn theo loại --' },
                    ...readyTemplates.map(template => ({ value: template.id, label: template.name })),
                  ]}
                  placeholder="Chọn mẫu DOCX"
                  className="w-full"
                />
                {readyTemplates.length === 0 && (
                  <p className="mt-2 text-metadata text-text-muted">Hệ thống sẽ dùng mẫu chuẩn theo loại văn bản.</p>
                )}
              </div>

              {/* File Upload */}
              <div>
                <h2 className="mb-2 text-control text-text-secondary">
                  Tài liệu tham khảo
                </h2>
                <label
                  className={cn(
                    'flex min-h-11 w-full cursor-pointer items-center justify-center rounded-control border border-dashed px-4 py-3 transition-colors duration-fast',
                    selectedFile
                      ? 'border-success bg-success-surface'
                      : 'border-border-strong bg-surface hover:border-text-muted',
                  )}
                >
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <div className="flex items-center gap-2 text-control">
                    <Upload aria-hidden="true" className="h-4 w-4 text-text-muted" />
                    {selectedFile ? (
                      <span className="text-success">{selectedFile.name}</span>
                    ) : (
                      <span className="text-text-secondary">Chọn tệp PDF</span>
                    )}
                  </div>
                </label>
              </div>

              {/* Prompt Input */}
              <div>
                <label htmlFor="generation-prompt" className="mb-2 block text-control text-text-secondary">
                  Nội dung yêu cầu
                </label>
                <textarea
                  id="generation-prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Mô tả nội dung văn bản cần tạo..."
                  rows={4}
                  className="control-field text-body"
                />
                {documentType && (
                  <button
                    onClick={handleExtractFields}
                    disabled={isExtracting || !prompt.trim()}
                    className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-control border border-border-strong bg-surface px-3 text-control font-medium text-text-primary transition-colors duration-fast hover:bg-surface-strong disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isExtracting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Đang trích xuất...
                      </>
                    ) : (
                      'Tự động điền từ yêu cầu'
                    )}
                  </button>
                )}
              </div>

              {/* Optional details stay compact so setup keeps one clear focus. */}
              {documentType && fields.length > 0 && (
                <div className="rounded-control border border-hairline bg-surface-subtle p-3">
                  <button
                    onClick={() => setShowFieldForm((v) => !v)}
                    aria-expanded={showFieldForm}
                    className="flex min-h-11 w-full items-center justify-between text-control text-text-primary"
                  >
                    <span className="font-medium">
                      Thông tin chi tiết ({fields.length} trường)
                    </span>
                    <span aria-hidden="true" className="text-text-muted">{showFieldForm ? '−' : '+'}</span>
                  </button>
                  {showFieldForm && (
                    <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
                      {fields.map((f) => (
                        <div key={f.name}>
                          {/* Select renders its own label, so avoid a dangling htmlFor. */}
                          {f.type !== 'select' && f.type !== 'boolean' && (
                            <label htmlFor={`field-${f.name}`} className="mb-1 block text-metadata text-text-secondary">
                              {f.label}
                              {f.required && <span className="ml-1 text-error">*</span>}
                            </label>
                          )}
                          {['textarea', 'list', 'object-list', 'table'].includes(f.type) ? (
                            <textarea
                              id={`field-${f.name}`}
                              value={fieldValues[f.name] || ''}
                              onChange={(e) =>
                                setFieldValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                              }
                              rows={3}
                              placeholder={f.description || (
                                f.type === 'list' ? 'Mỗi mục trên một dòng' :
                                f.type === 'object-list' || f.type === 'table'
                                  ? 'Nhập từng mục có cấu trúc trên một dòng'
                                  : f.label
                              )}
                              className="control-field text-control"
                            />
                          ) : f.type === 'select' || f.type === 'boolean' ? (
                            <Select
                              label={f.label}
                              value={fieldValues[f.name] || ''}
                              onValueChange={(value) => setFieldValues(prev => ({ ...prev, [f.name]: value }))}
                              options={(f.type === 'boolean' ? ['Có', 'Không'] : f.options || []).map(option => ({
                                value: option,
                                label: option,
                              }))}
                              placeholder={f.label}
                              className="w-full"
                            />
                          ) : (
                            <input
                              id={`field-${f.name}`}
                              type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                              value={fieldValues[f.name] || ''}
                              onChange={(e) =>
                                setFieldValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                              }
                              placeholder={f.description || f.label}
                              className="control-field text-control"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Generate Button */}
              {isGenerating ? (
                <Button
                  onClick={handleCancelGeneration}
                  variant="destructive"
                  size="lg"
                  className="w-full"
                >
                  Hủy tạo văn bản
                </Button>
              ) : (
                <Button
                  onClick={handleGenerate}
                    disabled={!prompt.trim() || !documentType}
                  size="lg"
                  className="w-full"
                >
                  Tạo văn bản
                </Button>
              )}

              {/* Review and export actions appear once there is output to act on. */}
              {isComplete && (
                <div className="space-y-2">
                  <Button
                    onClick={handleValidate}
                    variant="secondary"
                    size="lg"
                    className="w-full"
                  >
                    Kiểm tra Nghị định 30/2020
                  </Button>
                  <Button
                    onClick={() => { setHasEnteredExport(true); setConfirmExport(true); }}
                    variant="secondary"
                    size="lg"
                    className="w-full gap-2"
                  >
                    <FileText aria-hidden="true" className="h-4 w-4" />
                    Xuất tài liệu
                  </Button>
                </div>
              )}

              {/* Setup values survive a failure so the request can be retried. */}
              {error && <InlineAlert variant="error">{error}</InlineAlert>}
            </div>
          </div>

          {/* The document stays the visual centre. */}
          <div className="lg:col-span-8 xl:col-span-6">
            {generatedContent ? (
              <StreamingDocumentEditor
                initialValue={generatedContent}
                isStreaming={isGenerating}
                generationComplete={isComplete}
                onUserEdit={handleUserEdit}
                onCancelGeneration={handleCancelGeneration}
                onAcceptSuggestion={(value) => {
                  setOriginalContent(value);
                  setIsComplete(true);
                }}
                onEditFeedback={handleEditFeedback}
                documentType={documentType}
                readOnlyDuringStreaming={true}
                prompt={prompt}
                onStreamingStage={setStreamingStage}
                floatingToolbar={true}
              />
            ) : (
              <EmptyState
                title="Chưa có văn bản"
                description="Chọn loại văn bản, thêm tài liệu tham khảo nếu cần, rồi nhập yêu cầu để bắt đầu."
                className="min-h-[400px]"
              />
            )}
          </div>

          {/* Supporting panels: sources, validation, and fidelity. */}
          <div className="space-y-4 lg:col-span-12 xl:col-span-3">
            <SourcePanel sources={sources} />
            <ValidationPanel results={validationResults} />
            {fidelity && <FidelityWarningPanel fidelity={fidelity} />}
            <FeedbackPanel />
          </div>
      </div>

      <ExportConfirmationDialog
        open={confirmExport}
        onOpenChange={setConfirmExport}
        filename={formatResultName || `Van_ban_${new Date().toISOString().slice(0, 10)}.docx`}
        validationStatus={fidelity?.validationStatus}
        pending={isExporting}
        onConfirm={handleExportDocx}
      />
    </div>
  );
}
