import { useState, useEffect } from 'react';
import authService from '../services/authService';
import type { User } from '../types';

interface UseAdminPageReturn {
    user: User | null;
    loading: boolean;
}

const useAdminPage = (): UseAdminPageReturn => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const fetchUser = async () => {
            try {
                const data = await authService.checkLogin();
                if (data.isAuthenticated && data.user) {
                    setUser(data.user);
                }
            } catch (error) {
                console.error("Could not fetch user data for admin panel", error);
            } finally {
                setLoading(false);
            }
        };
        fetchUser();
    }, []);

    return { user, loading };
};

export default useAdminPage;
