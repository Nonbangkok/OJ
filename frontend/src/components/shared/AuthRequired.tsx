import { Link, useLocation } from 'react-router-dom';
import { useSettings } from '../../context/SettingsContext';
import styles from '../../features/auth/AuthForm.module.css';

/**
 * Private-mode landing (§7.10), shown inside AuthShell to signed-out
 * visitors. The intended destination rides along as returnTo so logging in
 * goes straight back to it.
 */
const AuthRequired = () => {
  const { registrationEnabled } = useSettings();
  const location = useLocation();
  const target = location.pathname + location.search;
  const loginHref = target === '/' ? '/login' : `/login?returnTo=${encodeURIComponent(target)}`;
  return (
    <div className={styles.card}>
      <h1 className={styles.title}>This Grader is private</h1>
      <p className={styles.lead}>Log in with the account your school gave you.</p>
      <div className={styles.actions}>
        <Link className={`${styles.link} ${styles.linkPrimary}`} to={loginHref}>Log in</Link>
        {registrationEnabled && (
          <Link className={`${styles.link} ${styles.linkSecondary}`} to="/register">Create account</Link>
        )}
      </div>
    </div>
  );
};

export default AuthRequired;
