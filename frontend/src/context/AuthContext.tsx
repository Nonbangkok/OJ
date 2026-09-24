import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import authService from '../services/authService';
import type { AuthUser } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (userData: AuthUser) => void;
  logout: () => Promise<void>;
}

interface AuthProviderProps {
  children: ReactNode;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
};

export const AuthProvider = ({ children }: AuthProviderProps) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkLoggedIn = useCallback(async () => {
    try {
      const data = await authService.checkLogin();
      if (data.isAuthenticated) {
        // Mark that a session existed at load time — the api 401 interceptor
        // uses this to distinguish "session expired mid-session" (redirect to
        // the expired-login flow) from a guest hitting an auth-required
        // endpoint (a normal guest state, never an expiry).
        window.sessionStorage.setItem('oj:had-session', '1');
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkLoggedIn();
  }, [checkLoggedIn]);

  const login = useCallback((userData: AuthUser) => {
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Logout failed', error);
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, logout }),
    [user, isLoading, login, logout]
  );

  return <AuthContext.Provider value={value}>{!isLoading && children}</AuthContext.Provider>;
};
