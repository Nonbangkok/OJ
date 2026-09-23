import useAdminPage from '../../hooks/useAdminPage';
import styles from './Admin.module.css';
import LoadingPage from '../../components/shared/LoadingPage';
import { USER_ROLES } from '../../utils/constants';
import { Link } from 'react-router-dom';

/** One navigation tile on the admin hub. Order matters only for display. */
interface AdminSectionLink {
  title: string;
  description: string;
  to: string;
  /** Roles allowed to see/use this section (mirrors the navbar's gating). */
  roles: readonly string[];
}

const ADMIN_SECTIONS: AdminSectionLink[] = [
  {
    title: 'Users',
    description: 'Manage users, roles, and account access.',
    to: '/admin/users',
    roles: [USER_ROLES.ADMIN],
  },
  {
    title: 'Problems',
    description: 'Manage problems, visibility, uploads, and editing.',
    to: '/admin/problems',
    roles: [USER_ROLES.ADMIN, USER_ROLES.STAFF],
  },
  {
    title: 'Contests',
    description: 'Create and manage contests.',
    to: '/admin/contests',
    roles: [USER_ROLES.ADMIN, USER_ROLES.STAFF],
  },
  {
    title: 'Authoring',
    description: 'Create drafts, statements, testcases, solutions, and publish problems.',
    to: '/admin/authoring',
    roles: [USER_ROLES.ADMIN, USER_ROLES.STAFF],
  },
  {
    title: 'Analysis',
    description: 'View statistics and judge data.',
    to: '/admin/analysis',
    roles: [USER_ROLES.ADMIN, USER_ROLES.STAFF],
  },
  {
    title: 'Settings',
    description: 'Configure admin and system options.',
    to: '/admin/settings',
    roles: [USER_ROLES.ADMIN],
  },
];

const Admin = () => {
  const { user, loading } = useAdminPage();

  if (loading) return <LoadingPage />;

  const sections = ADMIN_SECTIONS.filter((section) =>
    section.roles.includes(user?.role ?? ''));

  return (
    <div className={styles['admin-container']}>
      <h1>Admin Panel</h1>
      <p className={styles['admin-subtitle']}>
        Manage users, problems, contests, authoring, analytics, and system settings.
      </p>
      <nav className={styles['hub-grid']} aria-label="Admin sections">
        {sections.map((section) => (
          <Link key={section.to} to={section.to} className={styles['hub-card']}>
            <span className={styles['hub-card-title']}>
              {section.title}
              <span className={styles['hub-card-arrow']} aria-hidden="true">→</span>
            </span>
            <span className={styles['hub-card-description']}>{section.description}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
};

export default Admin;
