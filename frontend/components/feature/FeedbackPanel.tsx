'use client';

import React from 'react';
import { Card } from '@/components/ui/card';
import { Edit3 } from 'lucide-react';
import { cn } from '@/components/lib/cn';

interface FeedbackPanelProps {
  className?: string;
}

export function FeedbackPanel({ className }: FeedbackPanelProps) {
  return (
    <Card className={cn('p-4', className)} variant="elevated">
      <h3 className="font-semibold text-control text-text-muted mb-3 flex items-center gap-2">
        <Edit3 className="w-4 h-4" />
        Phản hồi chỉnh sửa
      </h3>
      <p className="text-metadata text-text-muted text-center py-4">
        Các chỉnh sửa bạn thực hiện sẽ được ghi nhận để hệ thống tự học.
      </p>
    </Card>
  );
}
