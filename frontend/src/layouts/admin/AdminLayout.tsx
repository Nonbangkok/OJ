import { Outlet, Navigate, useLocation } from 'react-router-dom';
import AdminNavbar from './AdminNavbar';
import { useAuth } from '../../context/AuthContext';
import { USER_ROLES } from '../../utils/constants';

const AdminLayout = () => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return <div>Loading admin layout...</div>;
  }

  if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.STAFF)) {
    return <Navigate to="/" replace />;
  }

  if (/^\/admin\/authoring\/[^/]+\/editor\/?$/.test(location.pathname)) return <Outlet />;

  return (
    <>
      <AdminNavbar />
      <main className="container admin-main">
        <Outlet />
      </main>
    </>
  );
};

export default AdminLayout;
