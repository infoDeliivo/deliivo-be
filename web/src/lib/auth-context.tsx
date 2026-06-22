'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getTokens, clearTokens, setTokens, userApi, UserProfile } from './api';

interface AuthContextType {
  user: UserProfile | null;
  loading: boolean;
  login: (accessToken: string, refreshToken: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
  refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const tokens = getTokens();
    if (!tokens) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await userApi.getMe();
      setUser(res.data);
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refreshOnResume = () => {
      if (document.visibilityState === 'visible') {
        void fetchUser();
      }
    };
    window.addEventListener('focus', refreshOnResume);
    window.addEventListener('online', refreshOnResume);
    document.addEventListener('visibilitychange', refreshOnResume);
    return () => {
      window.removeEventListener('focus', refreshOnResume);
      window.removeEventListener('online', refreshOnResume);
      document.removeEventListener('visibilitychange', refreshOnResume);
    };
  }, [fetchUser]);

  const login = async (accessToken: string, refreshToken: string) => {
    setTokens({ accessToken, refreshToken });
    await fetchUser();
  };

  const logout = () => {
    clearTokens();
    setUser(null);
    window.location.href = '/';
  };

  const refreshUser = fetchUser;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
