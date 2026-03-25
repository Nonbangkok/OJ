import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import authService from '../services/authService';
import { getErrorMessage } from '../utils/error';

interface SettingsState {
  registrationEnabled: boolean;
}

export interface SettingsContextValue extends SettingsState {
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
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
  const [settings, setSettings] = useState<SettingsState>({ registrationEnabled: false });
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = useCallback(async (): Promise<void> => {
    try {
      const data = await authService.getRegistrationSettings();
      setSettings({
        registrationEnabled: data.enabled,
      });
    } catch (error) {
      console.error(getErrorMessage(error, 'Failed to fetch system settings.'));
      setSettings({
        registrationEnabled: false,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      ...settings,
      isLoading,
      refreshSettings: fetchSettings,
    }),
    [settings, isLoading, fetchSettings],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
};
