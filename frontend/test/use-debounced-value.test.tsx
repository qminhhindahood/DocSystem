import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from '@/lib/use-debounced-value';

function Harness({ value, delayMs = 275 }: { value: string; delayMs?: number }) {
  const debounced = useDebouncedValue(value, delayMs);
  return <span data-testid="debounced">{debounced}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDebouncedValue', () => {
  it('returns the initial value immediately', () => {
    render(<Harness value="cũ" />);

    expect(screen.getByTestId('debounced')).toHaveTextContent('cũ');
  });

  it('holds the previous value until the delay elapses', () => {
    const { rerender } = render(<Harness value="cũ" />);
    rerender(<Harness value="mới" />);

    act(() => {
      vi.advanceTimersByTime(274);
    });
    expect(screen.getByTestId('debounced')).toHaveTextContent('cũ');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('debounced')).toHaveTextContent('mới');
  });

  it('restarts the delay when the value changes again', () => {
    const { rerender } = render(<Harness value="a" />);

    rerender(<Harness value="ab" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender(<Harness value="abc" />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    // The first pending update was cancelled, so nothing has settled yet.
    expect(screen.getByTestId('debounced')).toHaveTextContent('a');

    act(() => {
      vi.advanceTimersByTime(75);
    });
    expect(screen.getByTestId('debounced')).toHaveTextContent('abc');
  });

  it('does not emit a stale value after unmount', () => {
    const { rerender, unmount } = render(<Harness value="cũ" />);
    rerender(<Harness value="mới" />);
    unmount();

    expect(() =>
      act(() => {
        vi.advanceTimersByTime(275);
      }),
    ).not.toThrow();
  });
});
