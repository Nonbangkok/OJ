import { useState, useEffect } from 'react';
import authService from '../services/authService';
import type { AuthUser } from '../types';

interface UseAdminPageResult {
  user: AuthUser | null;
  loading: boolean;
}

const useAdminPage = (): UseAdminPageResult => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const data = await authService.checkLogin();
        if (data.isAuthenticated) {
          setUser(data.user);
        }
      } catch (error) {
        console.error('Could not fetch user data for admin panel', error);
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, []);

  return { user, loading };
};

export default useAdminPage;
