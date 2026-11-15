import { Outlet, Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { USER_ROLES } from '../../utils/constants';

const AdminLayout = () => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading admin layout...</div>;
  }

  if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.STAFF)) {
    return <Navigate to="/" replace />;
  }

  // The shell (sidebar, container) comes from RootLayout; this route only guards roles.
  return <Outlet />;
};

export default AdminLayout;
