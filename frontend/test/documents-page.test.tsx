import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listDocuments = vi.fn();
const getDocument = vi.fn();

vi.mock('@/lib/api', () => ({
  listDocuments: (...args: unknown[]) => listDocuments(...args),
  getDocument: (...args: unknown[]) => getDocument(...args),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

const item = {
  id: 'doc-1', docType: 'cong-van', title: 'Tài liệu kiểm thử', status: 'draft',
  createdAt: '2026-07-15T00:00:00Z', updatedAt: '2026-07-15T00:00:00Z',
  _count: { chunks: 1, feedback: 0 },
};

function renderPage(Page: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}

const loadPage = async () => {
  const { default: DocumentsPage } = await import('@/app/(app)/documents/page');
  return DocumentsPage;
};

beforeEach(() => {
  vi.clearAllMocks();
  listDocuments.mockResolvedValue({
    success: true, data: [item], meta: { total: 45, limit: 20, offset: 0, pages: 3 },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DocumentsPage', () => {
  it('keeps search text clear of its leading icon', async () => {
    renderPage(await loadPage());
    const search = screen.getByRole('searchbox', { name: 'Tìm kiếm tài liệu' });

    expect(search).toHaveClass('control-field-leading-icon');
    expect(search).not.toHaveClass('pl-10');
  });

  it('gives every toolbar field a stable browser form name', async () => {
    renderPage(await loadPage());

    expect(screen.getByRole('searchbox', { name: /Tìm kiếm/ })).toHaveAttribute('name', 'document-search');
    expect(screen.getByLabelText('Lọc theo loại văn bản')).toHaveAttribute('name', 'document-type');
    expect(screen.getByLabelText('Lọc theo trạng thái')).toHaveAttribute('name', 'document-status');
  });

  it('shows one page heading and the real document count', async () => {
    renderPage(await loadPage());

    // Wait for data so the count reflects the response rather than the initial 0.
    await screen.findByText('Tài liệu kiểm thử');
    expect(screen.getByRole('heading', { name: 'Tài liệu', level: 1 })).toBeVisible();
    expect(screen.getByText('45 tài liệu')).toBeVisible();
    expect(screen.getByRole('link', { name: /Tạo tài liệu/ })).toHaveAttribute('href', '/generate');
  });

  it('debounces search by 275ms before querying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage(await loadPage());
    await screen.findByText('Tài liệu kiểm thử');
    listDocuments.mockClear();

    await user.type(screen.getByRole('searchbox', { name: /Tìm kiếm/ }), 'công văn');

    // The field updates immediately, but no request carries `q` yet.
    expect(listDocuments).not.toHaveBeenCalledWith(expect.objectContaining({ q: 'công văn' }));

    await vi.advanceTimersByTimeAsync(275);
    await waitFor(() =>
      expect(listDocuments).toHaveBeenCalledWith(expect.objectContaining({ q: 'công văn' })),
    );
  });

  it('resets pagination to the first page when a filter changes', async () => {
    const user = userEvent.setup();
    renderPage(await loadPage());
    await screen.findByText('Tài liệu kiểm thử');

    await user.click(screen.getByRole('button', { name: 'Trang sau' }));
    await waitFor(() =>
      expect(listDocuments).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 })),
    );

    await user.selectOptions(screen.getByLabelText('Lọc theo trạng thái'), 'draft');

    await waitFor(() =>
      expect(listDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'draft', offset: 0 }),
      ),
    );
    expect(screen.getByText('Trang 1 / 3')).toBeVisible();
  });

  it('keeps existing rows visible while the next query is fetching', async () => {
    const user = userEvent.setup();
    renderPage(await loadPage());
    await screen.findByText('Tài liệu kiểm thử');

    let release: (value: unknown) => void = () => {};
    listDocuments.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    await user.selectOptions(screen.getByLabelText('Lọc theo trạng thái'), 'draft');

    // Previous data is preserved rather than flashing an empty or loading list.
    expect(screen.getByText('Tài liệu kiểm thử')).toBeVisible();

    release({ success: true, data: [item], meta: { total: 1, limit: 20, offset: 0, pages: 1 } });
    await waitFor(() => expect(screen.getByText('Tài liệu kiểm thử')).toBeVisible());
  });

  it('clears search, filters, and pagination together', async () => {
    const user = userEvent.setup();
    renderPage(await loadPage());
    await screen.findByText('Tài liệu kiểm thử');

    await user.selectOptions(screen.getByLabelText('Lọc theo trạng thái'), 'draft');
    await user.selectOptions(screen.getByLabelText('Lọc theo loại văn bản'), 'cong-van');
    await user.click(await screen.findByRole('button', { name: 'Xóa bộ lọc' }));

    await waitFor(() =>
      expect(listDocuments).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: undefined, docType: undefined, q: undefined, offset: 0 }),
      ),
    );
  });

  it('hides the clear action until a filter is active', async () => {
    const user = userEvent.setup();
    renderPage(await loadPage());
    await screen.findByText('Tài liệu kiểm thử');

    expect(screen.queryByRole('button', { name: 'Xóa bộ lọc' })).toBeNull();

    await user.selectOptions(screen.getByLabelText('Lọc theo trạng thái'), 'draft');

    expect(await screen.findByRole('button', { name: 'Xóa bộ lọc' })).toBeVisible();
  });

  it('shows only supported columns and no unsupported metadata', async () => {
    renderPage(await loadPage());
    await screen.findByText('Tài liệu kiểm thử');

    expect(screen.getByRole('columnheader', { name: 'Tài liệu' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Loại tài liệu' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Cập nhật' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Trạng thái' })).toBeVisible();

    // No backend contract supplies these, so they must not be invented.
    for (const label of [/thư mục/i, /người tải/i, /kích thước/i, /lưu trữ/i, /sắp xếp/i]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('marks only the selected row busy while its detail loads', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => {};
    getDocument.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; }),
    );
    listDocuments.mockResolvedValue({
      success: true,
      data: [item, { ...item, id: 'doc-2', title: 'Tài liệu thứ hai' }],
      meta: { total: 2, limit: 20, offset: 0, pages: 1 },
    });
    renderPage(await loadPage());

    await user.click(await screen.findByRole('button', { name: /Tài liệu kiểm thử/ }));

    const busy = screen.getByRole('button', { name: /Tài liệu kiểm thử/ });
    const other = screen.getByRole('button', { name: /Tài liệu thứ hai/ });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(other).not.toHaveAttribute('aria-busy', 'true');

    release({ data: { ...item, content: 'x', chunks: [], feedback: [] } });
    await waitFor(() => expect(busy).not.toHaveAttribute('aria-busy', 'true'));
  });

  it('requests and announces accessible pagination', async () => {
    const user = userEvent.setup();
    renderPage(await loadPage());

    await screen.findByText('Tài liệu kiểm thử');
    expect(screen.getByText('Trang 1 / 3')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Trang sau' }));

    await waitFor(() => expect(listDocuments).toHaveBeenLastCalledWith(expect.objectContaining({
      limit: 20, offset: 20,
    })));
    expect(screen.getByText('Trang 2 / 3')).toBeInTheDocument();
  });

  it('shows a Vietnamese error when document details cannot be loaded', async () => {
    const user = userEvent.setup();
    getDocument.mockRejectedValueOnce(new Error('network'));
    renderPage(await loadPage());

    await user.click(await screen.findByRole('button', { name: /Tài liệu kiểm thử/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Không thể tải chi tiết tài liệu. Vui lòng thử lại.');
  });

  it('keeps a list error distinct from a detail error and offers retry', async () => {
    const user = userEvent.setup();
    listDocuments.mockRejectedValue(new Error('network'));
    renderPage(await loadPage());

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không thể tải danh sách tài liệu. Vui lòng thử lại.',
    );

    listDocuments.mockResolvedValue({
      success: true, data: [item], meta: { total: 1, limit: 20, offset: 0, pages: 1 },
    });
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));

    expect(await screen.findByText('Tài liệu kiểm thử')).toBeVisible();
  });

  it('explains an empty library and offers the first action', async () => {
    listDocuments.mockResolvedValue({
      success: true, data: [], meta: { total: 0, limit: 20, offset: 0, pages: 1 },
    });
    renderPage(await loadPage());

    const heading = await screen.findByRole('heading', { name: 'Chưa có tài liệu' });
    expect(heading).toBeVisible();
    // The header action and the empty-state action both point at generation.
    const links = screen.getAllByRole('link', { name: /Tạo tài liệu/ });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute('href', '/generate');
  });

  it('distinguishes a filtered empty result from an empty library', async () => {
    const user = userEvent.setup();
    renderPage(await loadPage());
    await screen.findByText('Tài liệu kiểm thử');

    listDocuments.mockResolvedValue({
      success: true, data: [], meta: { total: 0, limit: 20, offset: 0, pages: 1 },
    });
    await user.selectOptions(screen.getByLabelText('Lọc theo trạng thái'), 'draft');

    expect(
      await screen.findByRole('heading', { name: 'Không tìm thấy tài liệu phù hợp' }),
    ).toBeVisible();
  });
});
