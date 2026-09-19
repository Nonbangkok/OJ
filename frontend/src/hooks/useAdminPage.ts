import { useAuth } from '../context/AuthContext';
import type { AuthUser } from '../types';

interface UseAdminPageResult {
  user: AuthUser | null;
  loading: boolean;
}

/** Reads the session user from AuthContext — no extra /me request per page. */
const useAdminPage = (): UseAdminPageResult => {
  const { user, isLoading } = useAuth();

  return { user, loading: isLoading };
};

export default useAdminPage;
