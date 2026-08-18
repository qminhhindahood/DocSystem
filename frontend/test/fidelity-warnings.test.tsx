import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FidelityWarningPanel } from '@/components/feature/FidelityWarningPanel';
import {
  DocumentConfidenceStrip,
  buildDocumentConfidenceItems,
} from '@/components/documents/DocumentConfidenceStrip';
import type { FidelitySummary } from '@/lib/api';

function renderState(fidelity: FidelitySummary) {
  render(
    <>
      <FidelityWarningPanel fidelity={fidelity} />
      <button type="button">Tải DOCX</button>
    </>,
  );
}

describe('FidelityWarningPanel', () => {
  it('announces a passed visual check', () => {
    renderState({ validationStatus: 'passed', warnings: [] });

    expect(screen.getByText('Kiểm tra bố cục đã đạt')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('explains layout warnings without disabling download', () => {
    renderState({
      validationStatus: 'warnings',
      warnings: [
        {
          code: 'FONT_SUBSTITUTED', severity: 'warning', message: 'Font substituted',
          details: { requested: 'Times New Roman', resolved: 'Liberation Serif' },
        },
        {
          code: 'PAGE_COUNT_CHANGED', severity: 'high', message: 'Page count changed',
          details: { baseline: '1', generated: '2' },
        },
      ],
    });

    expect(screen.getByText('Đã tạo với cảnh báo bố cục')).toBeInTheDocument();
    expect(screen.getByText(/Times New Roman/)).toHaveTextContent('Liberation Serif');
    expect(screen.getByText(/1 trang/)).toHaveTextContent('2 trang');
    expect(screen.queryByText('FONT_SUBSTITUTED')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải DOCX' })).toBeEnabled();
  });

  it('explains unavailable visual validation without blocking download', () => {
    renderState({
      validationStatus: 'unavailable',
      warnings: [{ code: 'RENDER_TIMEOUT', severity: 'warning', message: 'Render timed out' }],
    });

    expect(screen.getByText('Đã tạo; không thể kiểm tra hình ảnh')).toBeInTheDocument();
    expect(screen.getAllByText(/mở tệp DOCX để kiểm tra/)).not.toHaveLength(0);
    expect(screen.queryByText('RENDER_TIMEOUT')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tải DOCX' })).toBeEnabled();
  });
});

describe('DocumentConfidenceStrip', () => {
  it('renders no markup when no trustworthy values exist', () => {
    const { container } = render(<DocumentConfidenceStrip items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('shows only the supplied values as labelled groups', () => {
    render(
      <DocumentConfidenceStrip
        items={[
          { id: 'sources', label: 'Số đoạn nguồn', value: '4' },
          { id: 'validation', label: 'Kiểm tra', value: 'Đã đạt', tone: 'positive' },
        ]}
      />,
    );

    expect(screen.getByText('Số đoạn nguồn')).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
    expect(screen.getByText('Kiểm tra')).toBeVisible();
    expect(screen.getByText('Đã đạt')).toBeVisible();
    // Absent fields are omitted rather than shown as unknown.
    expect(screen.queryByText('Mẫu văn bản')).toBeNull();
    expect(screen.queryByText('Lần kiểm tra')).toBeNull();
  });

  it('renders an action alongside the summary when supplied', () => {
    render(
      <DocumentConfidenceStrip
        items={[{ id: 'generation', label: 'Trạng thái', value: 'Đã xác minh' }]}
        action={<button type="button">Xuất DOCX</button>}
      />,
    );

    expect(screen.getByRole('button', { name: 'Xuất DOCX' })).toBeVisible();
  });
});

describe('buildDocumentConfidenceItems', () => {
  it('returns an empty list when the document carries no generation metadata', () => {
    expect(buildDocumentConfidenceItems(null)).toEqual([]);
    expect(buildDocumentConfidenceItems(undefined)).toEqual([]);
    expect(buildDocumentConfidenceItems({})).toEqual([]);
  });

  it('never presents unavailable validation as passed', () => {
    const items = buildDocumentConfidenceItems({
      validationStatus: 'unavailable',
      fidelityReport: { validationStatus: 'unavailable', warnings: [], passed: false, violations: [], repairs: [], pageCount: 1 },
    });
    const validation = items.find((item) => item.id === 'validation');

    expect(validation?.value).toBe('Không kiểm tra được');
    expect(validation?.value).not.toMatch(/đạt/i);
    expect(validation?.tone).not.toBe('positive');
  });

  it('reports a verified generation state and passed validation', () => {
    const items = buildDocumentConfidenceItems({
      state: 'verified',
      validationStatus: 'passed',
    });

    expect(items.find((item) => item.id === 'generation')?.value).toBe('Đã xác minh');
    expect(items.find((item) => item.id === 'validation')).toEqual({
      id: 'validation',
      label: 'Kiểm tra bố cục',
      value: 'Đã đạt',
      tone: 'positive',
    });
  });

  it('summarizes fidelity warnings using the real warning count', () => {
    const items = buildDocumentConfidenceItems({
      validationStatus: 'warnings',
      fidelityReport: {
        validationStatus: 'warnings',
        warnings: [
          { code: 'FONT_SUBSTITUTED', severity: 'warning', message: 'x' },
          { code: 'POSSIBLE_OVERFLOW', severity: 'info', message: 'y' },
        ],
        passed: false,
        violations: [],
        repairs: [],
        pageCount: 3,
      },
    });

    expect(items.find((item) => item.id === 'fidelity')).toEqual({
      id: 'fidelity',
      label: 'Cảnh báo bố cục',
      value: '2',
      tone: 'warning',
    });
  });

  it('omits page count when the report does not supply one', () => {
    const items = buildDocumentConfidenceItems({ state: 'verified' });

    expect(items.map((item) => item.id)).not.toContain('fidelity');
  });
});
