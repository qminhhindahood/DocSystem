'use client';

import React, { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { DocumentDefaultsForm } from './DocumentDefaultsForm';

export function DocumentDefaultsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const [dirty, setDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  function request(next: boolean) { if (!next && dirty) { setConfirmDiscard(true); return; } onOpenChange(next); if (!next) setConfirmDiscard(false); }
  return <Dialog.Root open={open} onOpenChange={request}><Dialog.Portal>
    <Dialog.Overlay className="fixed inset-0 z-backdrop bg-black/55" />
    <Dialog.Content className="fixed left-1/2 top-1/2 z-modal max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel bg-surface-strong p-5 shadow-floating focus:outline-none sm:p-6" aria-describedby="document-defaults-description">
      <div className="mb-5 pr-10"><Dialog.Title className="text-section-title">Thông tin mặc định</Dialog.Title><Dialog.Description id="document-defaults-description" className="mt-1 text-control text-text-muted">Các giá trị này sẽ tự động điền vào mẫu khi tạo văn bản.</Dialog.Description></div>
      <button type="button" onClick={() => request(false)} aria-label="Đóng thông tin mặc định" className="absolute right-4 top-4 rounded-compact p-2 text-text-muted hover:bg-surface-strong"><X className="h-4 w-4" /></button>
      <div hidden={confirmDiscard}><DocumentDefaultsForm onDirtyChange={setDirty} onSaved={() => { setDirty(false); onOpenChange(false); toast({ title: 'Đã lưu thông tin mặc định', description: 'Các văn bản mới sẽ sử dụng thông tin vừa cập nhật.', variant: 'success' }); }} /></div>
      {confirmDiscard && <div role="alert" className="rounded-panel border border-warning/30 bg-warning-surface p-4"><p className="font-medium">Bỏ các thay đổi chưa lưu?</p><p className="mt-1 text-control text-text-muted">Thông tin vừa chỉnh sửa sẽ không được lưu.</p><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirmDiscard(false)}>Tiếp tục chỉnh sửa</Button><Button variant="destructive" onClick={() => { setDirty(false); setConfirmDiscard(false); onOpenChange(false); }}>Bỏ thay đổi</Button></div></div>}
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}
