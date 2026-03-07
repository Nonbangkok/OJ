import { useState, useEffect } from 'react';
import authService from '../../services/authService';
import UserManagement from '../../features/admin/users/UserManagement';
import ProblemManagement from '../../features/admin/problems/ProblemManagement';
import ContestManagement from '../../features/admin/contests/ContestManagement';
import Settings from '../../features/admin/settings/Settings';
import styles from './Admin.module.css';

const Admin = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const data = await authService.checkLogin();
        if (data.isAuthenticated) {
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

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div className={styles['admin-container']}>
      <h1>Admin Panel</h1>

      {user?.role === 'admin' && (
        <div className={styles['admin-section']}>
          <UserManagement />
        </div>
      )}

      {(user?.role === 'admin' || user?.role === 'staff') && (
        <div className={styles['admin-section']}>
          <ProblemManagement currentUser={user} />
        </div>
      )}

      {(user?.role === 'admin' || user?.role === 'staff') && (
        <div className={styles['admin-section']}>
          <ContestManagement currentUser={user} />
        </div>
      )}

      {user?.role === 'admin' && (
        <div className={styles['admin-section']}>
          <Settings />
        </div>
      )}
    </div>
  );
};

export default Admin; 