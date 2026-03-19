import { createContext, useState, useEffect, useContext } from 'react';
import authService from '../services/authService';

export const SettingsContext = createContext();

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    registrationEnabled: false, // Default to false initially
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = async () => {
    try {
      const data = await authService.getRegistrationSettings();
      setSettings({
        registrationEnabled: data.enabled,
      });
    } catch (error) {
      console.error('Failed to fetch system settings:', error);
      // In case of error, default to registration being disabled for safety
      setSettings({
        registrationEnabled: false,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const value = {
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