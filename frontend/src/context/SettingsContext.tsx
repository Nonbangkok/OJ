import { createContext, useState, useEffect, useContext, ReactNode } from 'react';
import authService from '../services/authService';
import type { AdminSettings } from '../types';

interface SettingsContextType extends AdminSettings {
  isLoading: boolean;
  refreshSettings: () => Promise<void>;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const useSettings = (): SettingsContextType => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

interface SettingsProviderProps {
  children: ReactNode;
}

export const SettingsProvider = ({ children }: SettingsProviderProps) => {
  const [settings, setSettings] = useState<AdminSettings>({
    registrationEnabled: false, // Default to false initially
    contestCreationEnabled: false,
    systemMaintenance: false,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const fetchSettings = async (): Promise<void> => {
    try {
      const data = await authService.getRegistrationSettings();
      setSettings({
        registrationEnabled: data.enabled || false,
        contestCreationEnabled: false, // This would need to be added to the API
        systemMaintenance: false, // This would need to be added to the API
      });
    } catch (error) {
      console.error('Failed to fetch system settings:', error);
      // In case of error, default to registration being disabled for safety
      setSettings({
        registrationEnabled: false,
        contestCreationEnabled: false,
        systemMaintenance: false,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const value: SettingsContextType = {
    ...settings,
    isLoading,
    refreshSettings: fetchSettings, // Expose the fetch function
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}; 