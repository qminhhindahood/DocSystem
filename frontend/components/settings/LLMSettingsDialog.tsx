'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Settings, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LLMProviderForm } from './LLMProviderForm';
import { useToast } from '@/components/ui/toast';

/** Window event that opens this dialog from anywhere (e.g. the scanned-PDF
 * 422 error deep-links here with "Cấu hình khóa API"). */
export const OPEN_LLM_SETTINGS_EVENT = 'open-llm-settings';

export function LLMSettingsDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const dirtyRef = useRef(false);

  function requestOpen(next: boolean) {
    if (!next && dirtyRef.current) { setConfirmDiscard(true); return; }
    setOpen(next); if (!next) setConfirmDiscard(false);
  }

  useEffect(() => {
    function onOpenRequest() { requestOpen(true); }
    window.addEventListener(OPEN_LLM_SETTINGS_EVENT, onOpenRequest);
    return () => window.removeEventListener(OPEN_LLM_SETTINGS_EVENT, onOpenRequest);
  }, []);

  return <Dialog.Root open={open} onOpenChange={requestOpen}>
    <Dialog.Trigger asChild>
      {/* Matches the sidebar footer row grammar; the label names the control. */}
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-control text-text-secondary transition-colors duration-fast hover:bg-surface-strong hover:text-text-primary"
      >
        <Settings className="h-5 w-5 flex-shrink-0" />
        <span className="truncate">Cấu hình khóa API</span>
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/55" />
      <Dialog.Content className="fixed left-1/2 top-1/2 z-modal max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel bg-surface-strong p-5 shadow-floating focus:outline-none sm:p-6" aria-describedby="llm-settings-description">
        <div className="mb-5 pr-10">
          <Dialog.Title className="text-section-title text-text-primary">Cấu hình khóa API</Dialog.Title>
          <Dialog.Description id="llm-settings-description" className="mt-1 text-control text-text-muted">Khóa của bạn được lưu riêng cho tài khoản này. Khóa Google Gemini dùng để chuyển đổi PDF có trang quét (scanned); OpenRouter được lưu cho tính năng hỏi đáp sắp ra mắt.</Dialog.Description>
        </div>
        <button type="button" onClick={() => requestOpen(false)} aria-label="Đóng cài đặt" className="absolute right-4 top-4 rounded-compact p-2 text-text-muted hover:bg-surface-strong hover:text-text-primary"><X className="h-4 w-4" /></button>
        <div hidden={confirmDiscard}><LLMProviderForm onDirtyChange={(value) => { dirtyRef.current = value; }} onSaved={() => { dirtyRef.current = false; setOpen(false); toast({ title: 'Đã lưu cấu hình khóa API', description: 'Nhà cung cấp của bạn đã được cập nhật.', variant: 'success' }); }} /></div>
        {confirmDiscard && <div role="alert" className="rounded-panel border border-warning/30 bg-warning-surface p-4">
          <p className="font-medium text-text-primary">Bỏ các thay đổi chưa lưu?</p>
          <p className="mt-1 text-control text-text-muted">Những thông tin bạn vừa chỉnh sửa sẽ không được lưu.</p>
          <div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirmDiscard(false)}>Tiếp tục chỉnh sửa</Button><Button variant="destructive" onClick={() => { dirtyRef.current = false; setConfirmDiscard(false); setOpen(false); }}>Bỏ thay đổi</Button></div>
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
