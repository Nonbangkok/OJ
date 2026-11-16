import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { lastManagePage } from '../../features/admin/lastManagePage';

/** `/admin` is no longer a hub (§7.8): it returns to the last Manage page, or Problems. */
const Admin = () => {
  const { user } = useAuth();
  return <Navigate to={lastManagePage(user?.role)} replace />;
};

export default Admin;
