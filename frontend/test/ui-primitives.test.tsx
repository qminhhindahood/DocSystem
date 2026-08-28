import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { InlineAlert } from '@/components/ui/inline-alert';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { Select } from '@/components/ui/select';

describe('shared UI primitives', () => {
  it('keeps portalled selection menus above modal content', async () => {
    const user = userEvent.setup();
    render(
      <Select
        ariaLabel="Nhà cung cấp"
        value="openrouter"
        onValueChange={vi.fn()}
        options={[
          { value: 'openrouter', label: 'OpenRouter' },
          { value: 'openai', label: 'OpenAI' },
        ]}
      />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Nhà cung cấp' }));
    expect(screen.getByRole('listbox')).toHaveClass('z-popover');
    expect(screen.getByRole('option', { name: 'OpenAI' })).toBeVisible();
  });

  it('uses control geometry for buttons and compact geometry for icon actions', () => {
    render(
      <>
        <Button>Tiếp tục</Button>
        <Button variant="ghost">Đóng</Button>
        <Button variant="icon" aria-label="Đóng hộp thoại" />
      </>,
    );

    // Pill is reserved for badges, search, and filter chips.
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toHaveClass('rounded-control');
    expect(screen.getByRole('button', { name: 'Tiếp tục' })).toHaveClass('min-h-11');
    expect(screen.getByRole('button', { name: 'Đóng' })).toHaveClass('rounded-control');
    expect(screen.getByRole('button', { name: 'Đóng hộp thoại' })).toHaveClass(
      'rounded-compact',
      'min-h-11',
      'min-w-11',
    );
  });

  it('keeps a destructive button readable in both themes', () => {
    render(<Button variant="destructive">Xóa tài liệu</Button>);

    const button = screen.getByRole('button', { name: 'Xóa tài liệu' });
    expect(button).toHaveClass('bg-error');
    // Tokenized foreground, not a hardcoded white that breaks the dark palette.
    expect(button).toHaveClass('text-on-action');
  });

  it('gives primary actions a 44px touch target', () => {
    render(<Button size="lg">Tạo tài liệu</Button>);

    expect(screen.getByRole('button', { name: 'Tạo tài liệu' })).toHaveClass('min-h-11');
  });

  it('disables and announces a loading button', () => {
    render(<Button isLoading>Đang lưu</Button>);

    expect(screen.getByRole('button', { name: 'Đang lưu' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Đang lưu' })).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps a disabled button labelled', () => {
    render(<Button disabled>Xuất tài liệu</Button>);

    const button = screen.getByRole('button', { name: 'Xuất tài liệu' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName('Xuất tài liệu');
  });

  it('associates input errors with their fields', () => {
    render(<Input id="title" label="Tiêu đề" error="Bắt buộc" />);

    const input = screen.getByLabelText('Tiêu đề');
    const error = screen.getByText('Bắt buộc');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', error.id);
  });

  it('associates input helper text without shadowing an error', () => {
    render(<Input id="docnum" label="Số văn bản" helperText="Ví dụ: 123/QĐ-UBND" />);

    const input = screen.getByLabelText('Số văn bản');
    const helper = screen.getByText('Ví dụ: 123/QĐ-UBND');
    expect(input).toHaveAttribute('aria-describedby', helper.id);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('associates textarea errors with their fields', () => {
    render(<Textarea id="summary" label="Tóm tắt" error="Quá ngắn" />);

    const textarea = screen.getByLabelText('Tóm tắt');
    const error = screen.getByText('Quá ngắn');
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea).toHaveAttribute('aria-describedby', error.id);
  });

  it('keeps semantic badge meaning in visible text', () => {
    render(<Badge variant="success">Sẵn sàng</Badge>);
    expect(screen.getByText('Sẵn sàng')).toHaveClass('bg-success-surface');
  });
});

describe('PageHeader', () => {
  it('renders one level-1 heading with supporting content', () => {
    render(
      <PageHeader
        title="Tài liệu"
        description="Quản lý và tra cứu văn bản đã tạo."
        meta={<span>12 tài liệu</span>}
        actions={<Button>Tạo tài liệu</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Tài liệu', level: 1 })).toBeVisible();
    expect(screen.getByText('Quản lý và tra cứu văn bản đã tạo.')).toBeVisible();
    expect(screen.getByText('12 tài liệu')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tạo tài liệu' })).toBeVisible();
  });

  it('renders the title alone when no supporting content is supplied', () => {
    render(<PageHeader title="Cài đặt" />);

    expect(screen.getByRole('heading', { name: 'Cài đặt', level: 1 })).toBeVisible();
  });
});

describe('EmptyState', () => {
  it('explains the state and offers one next action', () => {
    render(
      <EmptyState
        title="Chưa có tài liệu"
        description="Tạo tài liệu đầu tiên để bắt đầu."
        action={<Button>Tạo tài liệu</Button>}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Chưa có tài liệu' })).toBeVisible();
    expect(screen.getByText('Tạo tài liệu đầu tiên để bắt đầu.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Tạo tài liệu' })).toBeVisible();
  });

  it('hides a decorative icon from assistive technology', () => {
    const Icon = ({ className }: { className?: string }) => (
      <svg className={className} data-testid="empty-icon" />
    );
    render(
      <EmptyState title="Không có kết quả" description="Thử bộ lọc khác." icon={Icon} />,
    );

    expect(screen.getByTestId('empty-icon').parentElement).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('InlineAlert', () => {
  it('announces an error to assistive technology', () => {
    render(<InlineAlert variant="error">Không thể tải dữ liệu</InlineAlert>);

    expect(screen.getByRole('alert')).toHaveTextContent('Không thể tải dữ liệu');
  });

  it('uses a polite status role for non-error variants', () => {
    render(<InlineAlert variant="info">Đang xử lý mẫu.</InlineAlert>);

    expect(screen.getByRole('status')).toHaveTextContent('Đang xử lý mẫu.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders a title and an action alongside the message', () => {
    render(
      <InlineAlert variant="warning" title="Thiếu mẫu" action={<Button>Chọn mẫu</Button>}>
        Chưa chọn mẫu DOCX.
      </InlineAlert>,
    );

    expect(screen.getByText('Thiếu mẫu')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Chọn mẫu' })).toBeVisible();
  });
});

describe('LoadingSkeleton', () => {
  it('exposes a Vietnamese loading label and hides its placeholder bars', () => {
    render(<LoadingSkeleton rows={3} label="Đang tải tài liệu" />);

    const region = screen.getByRole('status');
    expect(region).toHaveAccessibleName('Đang tải tài liệu');
    expect(region.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });
});

describe('ConfirmDialog', () => {
  const openDialog = async (
    props: Partial<React.ComponentProps<typeof import('@/components/ui/confirm-dialog').ConfirmDialog>> = {},
  ) => {
    const { ConfirmDialog } = await import('@/components/ui/confirm-dialog');
    const onConfirm = props.onConfirm ?? vi.fn();
    const onOpenChange = props.onOpenChange ?? vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Xóa mẫu"
        description="Hành động này không thể hoàn tác."
        confirmLabel="Xóa"
        onConfirm={onConfirm}
        {...props}
      />,
    );
    return { onConfirm, onOpenChange };
  };

  it('names and describes itself for assistive technology', async () => {
    await openDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
    expect(dialog).toHaveAccessibleName('Xóa mẫu');
  });

  it('closes after a successful asynchronous confirmation', async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const { onOpenChange } = await openDialog({ onConfirm });

    await userEvent.click(screen.getByRole('button', { name: 'Xóa' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('stays open when confirmation rejects', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('failed'));
    const { onOpenChange } = await openDialog({ onConfirm });

    await userEvent.click(screen.getByRole('button', { name: 'Xóa' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('prevents duplicate confirmation while pending', async () => {
    const onConfirm = vi.fn();
    await openDialog({ onConfirm, pending: true });

    const confirm = screen.getByRole('button', { name: 'Xóa' });
    expect(confirm).toBeDisabled();
    await userEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('offers a cancel action that does not confirm', async () => {
    const { onConfirm, onOpenChange } = await openDialog({ cancelLabel: 'Hủy' });

    await userEvent.click(screen.getByRole('button', { name: 'Hủy' }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
