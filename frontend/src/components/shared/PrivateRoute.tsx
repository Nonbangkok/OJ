import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';

import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import AuthRequired from './AuthRequired';

interface PrivateRouteProps {
  children: ReactNode;
}

/**
 * Route gate for site-private mode: guests hitting protected content see the
 * shared AuthRequired screen (which preserves this route in returnTo for the
 * post-login bounce-back) instead of the normal page or a fetch error.
 *
 * Authenticated users pass through untouched — all existing per-route
 * permissions (hidden problems, contest access, admin roles) still apply
 * downstream exactly as before.
 */
const PrivateRoute = ({ children }: PrivateRouteProps) => {
  const { user, isLoading: authLoading } = useAuth();
  const { isPrivateMode, isLoading: settingsLoading } = useSettings();
  const location = useLocation();

  if (authLoading || settingsLoading) {
    // Both contexts hydrate once at app bootstrap. Rendering nothing here
    // (rather than the children) matters: the children would start fetching
    // protected data, and the resulting 401 would bounce the guest to the
    // session-expiry login before this gate can show the private-mode state.
    return null;
  }

  if (!isPrivateMode) {
    return <>{children}</>;
  }

  if (user) {
    return <>{children}</>;
  }

  return location ? <AuthRequired /> : <Navigate to="/login" replace />;
};

export default PrivateRoute;
