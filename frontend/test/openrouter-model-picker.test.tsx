import React, { useState } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OpenRouterModelPicker } from '@/components/settings/OpenRouterModelPicker';

const getModels = vi.fn();

vi.mock('@/lib/settings-api', () => ({
  getOpenRouterModels: (...args: unknown[]) => getModels(...args),
}));

const models = [
  {
    id: 'openrouter/free',
    name: 'Free Models Router',
    provider: 'openrouter',
    contextLength: 200_000,
    promptPricePerMillion: 0,
    completionPricePerMillion: 0,
    free: true,
    recommended: true,
  },
  {
    id: 'free/model:free',
    name: 'Free Model',
    provider: 'free',
    contextLength: 64_000,
    promptPricePerMillion: 0,
    completionPricePerMillion: 0,
    free: true,
    recommended: false,
  },
  {
    id: 'paid/model',
    name: 'Paid Model',
    provider: 'paid',
    contextLength: 32_000,
    promptPricePerMillion: 1,
    completionPricePerMillion: 2,
    free: false,
    recommended: false,
  },
];

function ControlledPicker({
  initialValue = '',
  onValueChange = vi.fn(),
}: {
  initialValue?: string;
  onValueChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  return <OpenRouterModelPicker value={value} onValueChange={(next) => {
    setValue(next);
    onValueChange(next);
  }} />;
}

describe('OpenRouter model picker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getModels.mockResolvedValue({ success: true, models, total: models.length });
  });

  it('groups recommendations, free models, and paid models without duplicates', async () => {
    const user = userEvent.setup();
    render(<OpenRouterModelPicker value="" onValueChange={vi.fn()} />);

    const combobox = screen.getByRole('combobox', { name: 'Mô hình' });
    expect(combobox).toHaveAttribute('aria-haspopup', 'listbox');
    await user.click(combobox);

    expect(await screen.findByText('Mô hình đề xuất')).toBeInTheDocument();
    expect(screen.getByText('Mô hình miễn phí')).toBeInTheDocument();
    expect(screen.getByText('Tất cả mô hình')).toBeInTheDocument();
    expect(screen.getAllByText('Free Models Router')).toHaveLength(1);
    expect(screen.getAllByText('Miễn phí')).toHaveLength(2);
    expect(screen.getByText('200K ngữ cảnh')).toBeInTheDocument();
    expect(screen.getByText(/\$1\/M vào · \$2\/M ra/)).toBeInTheDocument();
  });

  it('searches and selects the active result with the keyboard', async () => {
    const user = userEvent.setup();
    getModels.mockResolvedValue({ success: true, models: [models[2]], total: 1 });
    const onValueChange = vi.fn();
    render(<ControlledPicker onValueChange={onValueChange} />);

    const input = screen.getByRole('combobox', { name: 'Mô hình' });
    await user.click(input);
    await user.type(input, 'paid');
    expect(await screen.findByRole('option', { name: /Paid Model/ })).toBeInTheDocument();

    await user.keyboard('{ArrowDown}{Enter}');

    expect(onValueChange).toHaveBeenCalledWith('paid/model');
    expect(input).toHaveValue('paid/model');
  });

  it('retries a failed catalog request', async () => {
    const user = userEvent.setup();
    getModels
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({ success: true, models: [models[0]], total: 1 });
    render(<OpenRouterModelPicker value="" onValueChange={vi.fn()} />);

    await user.click(screen.getByRole('combobox', { name: 'Mô hình' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải danh mục mô hình');
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByRole('option', { name: /Free Models Router/ })).toBeInTheDocument();
    expect(getModels).toHaveBeenCalledTimes(2);
  });

  it('falls back to manual model entry without clearing the saved value', async () => {
    const user = userEvent.setup();
    getModels.mockRejectedValue(new Error('network'));
    const onValueChange = vi.fn();
    render(<ControlledPicker initialValue="alias/model" onValueChange={onValueChange} />);

    await user.click(screen.getByRole('combobox', { name: 'Mô hình' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải danh mục mô hình');
    await user.click(screen.getByRole('button', { name: 'Nhập ID mô hình thủ công' }));

    const manual = screen.getByRole('textbox', { name: 'ID mô hình thủ công' });
    expect(manual).toHaveValue('alias/model');
    await user.type(manual, '-new');
    await waitFor(() => expect(onValueChange).toHaveBeenLastCalledWith('alias/model-new'));
    await user.click(screen.getByRole('button', { name: 'Chọn từ danh mục' }));
    expect(screen.getByRole('combobox', { name: 'Mô hình' })).toHaveValue('alias/model-new');
  });
});
