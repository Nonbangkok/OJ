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
import { clearSessionExpiryRedirect } from '../services/api';
import type { AuthUser } from '../types';
import { bindSubmissionDraftsToUser, clearSubmissionDrafts } from '../utils/submissionDrafts';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (userData: AuthUser) => void;
  logout: () => Promise<void>;
  /**
   * Re-fetch /me and update the context user. Used when server-side state
   * changed outside a login (e.g. XP level-up on a realtime event) so the
   * navbar tier badge stays current (SCORE-008).
   */
  refreshUser: () => Promise<void>;
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

  // Keep the same object when nothing changed, so pages keyed on `user` do not refetch on every focus.
  const applyUser = useCallback((next: AuthUser | null) => {
    setUser(previous => (previous && next && JSON.stringify(previous) === JSON.stringify(next) ? previous : next));
  }, []);

  /** `background` re-checks (tab focus) keep the user on a failed request: a network blip or a 502 is not a logout. */
  const checkLoggedIn = useCallback(async (background = false) => {
    try {
      const data = await authService.checkLogin();
      if (data.isAuthenticated) {
        // Mark that a session existed at load time — the api 401 interceptor
        // uses this to distinguish "session expired mid-session" (redirect to
        // the expired-login flow) from a guest hitting an auth-required
        // endpoint (a normal guest state, never an expiry).
        window.sessionStorage.setItem('oj:had-session', '1');
        bindSubmissionDraftsToUser(data.user.id);
        applyUser(data.user);
      } else {
        // No session (never signed in, or it ended without a Logout click):
        // nobody owns the stored code drafts any more.
        bindSubmissionDraftsToUser(null);
        applyUser(null);
      }
    } catch {
      if (!background) applyUser(null);
    } finally {
      setIsLoading(false);
    }
  }, [applyUser]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bootstrap /me fetch; checkLoggedIn only sets state after its await resolves
    void checkLoggedIn();
  }, [checkLoggedIn]);

  // Roles are revalidated server-side on every request; re-read /me when the
  // tab comes back so the navigation follows a role change without a reload.
  useEffect(() => {
    const onReturn = () => {
      if (document.visibilityState === 'hidden') return;
      void checkLoggedIn(true);
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [checkLoggedIn]);

  const login = useCallback((userData: AuthUser) => {
    // A fresh session exists again, so re-arm the session-expiry redirect
    // (AUTH-008): without this the second expiry in the same tab would not
    // redirect because the one-shot loop-guard flag never reset.
    clearSessionExpiryRedirect();
    window.sessionStorage.setItem('oj:had-session', '1');
    // Another account signing in on this browser never sees the previous one's drafts.
    bindSubmissionDraftsToUser(userData.id);
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch (error) {
      console.error('Logout failed', error);
    } finally {
      // A guest's later 401s are normal, not a "session expired" redirect.
      window.sessionStorage.removeItem('oj:had-session');
      clearSubmissionDrafts();
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    await checkLoggedIn();
  }, [checkLoggedIn]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isLoading, login, logout, refreshUser }),
    [user, isLoading, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{!isLoading && children}</AuthContext.Provider>;
};
