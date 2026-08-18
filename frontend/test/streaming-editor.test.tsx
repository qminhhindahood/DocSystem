import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import StreamingDocumentEditor from '@/components/StreamingDocumentEditor';

vi.mock('next/dynamic', () => ({
  default: () => function MockEditor() { return <div aria-label="Trình soạn thảo" />; },
}));

vi.mock('@/lib/theme', () => ({
  useTheme: () => ({ theme: 'dark' }),
}));

describe('StreamingDocumentEditor completion', () => {
  it('does not infer completion when streaming stops without a terminal event', () => {
    const { rerender } = render(
      <StreamingDocumentEditor initialValue="Nội dung một phần" isStreaming={true} generationComplete={false} />,
    );
    rerender(
      <StreamingDocumentEditor initialValue="Nội dung một phần" isStreaming={false} generationComplete={false} />,
    );

    expect(screen.getByText('Sẵn sàng')).toBeInTheDocument();
    expect(screen.queryByText('Hoàn thành')).not.toBeInTheDocument();
  });

  it('shows cancellation during streaming and completion only when explicitly provided', () => {
    const cancel = vi.fn();
    const { rerender } = render(
      <StreamingDocumentEditor isStreaming={true} generationComplete={false} onCancelGeneration={cancel} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    expect(cancel).toHaveBeenCalledOnce();

    rerender(<StreamingDocumentEditor isStreaming={false} generationComplete={true} />);
    expect(screen.getByText('Hoàn thành')).toBeInTheDocument();
  });
});
