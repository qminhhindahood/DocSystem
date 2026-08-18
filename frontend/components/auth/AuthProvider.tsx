'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface User {
  id: string;
  username: string;
  createdAt?: string;
}

interface AuthState {
  user: User | null;
  status: 'loading' | 'authenticated' | 'anonymous';
}

interface AuthContextValue extends AuthState {
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, status: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/session/me');
      if (!res.ok) {
        setState({ user: null, status: 'anonymous' });
        return;
      }
      const data = await res.json();
      if (data.user) {
        setState({ user: data.user, status: 'authenticated' });
      } else {
        setState({ user: null, status: 'anonymous' });
      }
    } catch {
      setState({ user: null, status: 'anonymous' });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/session/logout', { method: 'POST' });
    } catch {
      // Clear even if backend unreachable
    }
    setState({ user: null, status: 'anonymous' });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ ...state, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
