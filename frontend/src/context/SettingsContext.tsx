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
import { getErrorMessage } from '../utils/error';

interface SettingsState {
  registrationEnabled: boolean;
  /** 'private' gates all OJ content behind login; 'public' keeps the
   *  historical open browsing. Loaded once before the app renders. */
  accessMode: 'public' | 'private';
}

export interface SettingsContextValue extends SettingsState {
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
  isPrivateMode: boolean;
}

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsContext = createContext<SettingsContextValue | undefined>(undefined);

export const useSettings = (): SettingsContextValue => {
  const context = useContext(SettingsContext);

  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }

  return context;
};

export const SettingsProvider = ({ children }: SettingsProviderProps) => {
  // Defaults mirror the backend's safe fallbacks: registration on, public
  // mode — so a failed fetch keeps the site browsable and the login page
  // reachable rather than locking guests out on a config hiccup.
  const [settings, setSettings] = useState<SettingsState>({
    registrationEnabled: true,
    accessMode: 'public',
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async (): Promise<void> => {
    try {
      const data = await authService.getSiteConfig();
      setSettings({
        registrationEnabled: data.allowRegistration,
        accessMode: data.accessMode,
      });
    } catch (error) {
      console.error(getErrorMessage(error, 'Failed to fetch system settings.'));
      setSettings({
        registrationEnabled: true,
        accessMode: 'public',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  // XSYS-011: registration/site-access settings were fetched once on mount,
  // so a toggle made by an admin in another tab never reached already-open
  // tabs (a stale "registration open" message, or a closed site reading as
  // open). Refetch on window focus — cheap, and catches the common
  // "came back to this tab" case.
  useEffect(() => {
    const onWindowFocus = () => {
      void fetchSettings();
    };
    window.addEventListener('focus', onWindowFocus);
    return () => window.removeEventListener('focus', onWindowFocus);
  }, [fetchSettings]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      isLoading,
      refreshSettings: fetchSettings,
      isPrivateMode: settings.accessMode === 'private',
    }),
    [settings, isLoading, fetchSettings]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};
