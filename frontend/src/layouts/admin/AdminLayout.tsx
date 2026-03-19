import { Outlet, Navigate } from 'react-router-dom';
import AdminNavbar from './AdminNavbar';
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

  return (
    <>
      <AdminNavbar />
      <main className="container">
        <Outlet />
      </main>
    </>
  );
};

export default AdminLayout; 