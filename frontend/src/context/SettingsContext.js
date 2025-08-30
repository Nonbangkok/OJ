import React, { createContext, useState, useEffect, useContext } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL;

const SettingsContext = createContext();

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState({
    registrationEnabled: false, // Default to false initially
  });
  const [isLoading, setIsLoading] = useState(true);

  const fetchSettings = async () => {
    try {
              const response = await axios.get(`${API_URL}/settings/registration`);
      setSettings({
        registrationEnabled: response.data.enabled,
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