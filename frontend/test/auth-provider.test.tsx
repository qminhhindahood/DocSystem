import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '@/components/auth/AuthProvider';

// Component to test auth context
function TestConsumer() {
  const { user, status, logout, refresh } = useAuth();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="user">{user ? user.username : 'null'}</div>
      <button onClick={logout}>Logout</button>
      <button onClick={refresh}>Refresh</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('loads user from session on mount', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: '1', username: 'alice' } }), { status: 200 }),
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });
    expect(screen.getByTestId('user')).toHaveTextContent('alice');
  });

  it('sets anonymous on 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 401 }));

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
    expect(screen.getByTestId('user')).toHaveTextContent('null');
  });

  it('logout clears user state', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: '1', username: 'alice' } }), { status: 200 }),
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 200 }));
    await userEvent.click(screen.getByText('Logout'));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
  });

  it('logout still clears state when backend returns 502', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ user: { id: '1', username: 'alice' } }), { status: 200 }),
    );

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    });

    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));
    await userEvent.click(screen.getByText('Logout'));

    await waitFor(() => {
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous');
    });
  });
});
