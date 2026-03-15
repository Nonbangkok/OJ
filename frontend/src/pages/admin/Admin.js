import useAdminPage from '../../hooks/useAdminPage';
import UserManagement from '../../features/admin/users/UserManagement';
import ProblemManagement from '../../features/admin/problems/ProblemManagement';
import ContestManagement from '../../features/admin/contests/ContestManagement';
import Settings from '../../features/admin/settings/Settings';
import styles from './Admin.module.css';
import LoadingPage from '../../components/shared/LoadingPage';
import { USER_ROLES } from '../../utils/constants';

const Admin = () => {
  const { user, loading } = useAdminPage();

  if (loading) return <LoadingPage />;

  return (
    <div className={styles['admin-container']}>
      <h1>Admin Panel</h1>

      {user?.role === USER_ROLES.ADMIN && (
        <div className={styles['admin-section']}>
          <UserManagement />
        </div>
      )}

      {(user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.STAFF) && (
        <div className={styles['admin-section']}>
          <ProblemManagement currentUser={user} />
        </div>
      )}

      {(user?.role === USER_ROLES.ADMIN || user?.role === USER_ROLES.STAFF) && (
        <div className={styles['admin-section']}>
          <ContestManagement currentUser={user} />
        </div>
      )}

      {user?.role === USER_ROLES.ADMIN && (
        <div className={styles['admin-section']}>
          <Settings />
        </div>
      )}
    </div>
  );
};

export default Admin; 