import { Link, useLocation } from 'react-router-dom';
import { Lock } from '@phosphor-icons/react';

import { useSettings } from '../../context/SettingsContext';

import styles from './AuthRequired.module.css';

/**
 * Shared guest-facing "sign in to continue" screen. Rendered by PrivateRoute
 * when the site is in private mode (or by any view that needs a clean
 * login-required state) — the intended destination is preserved via the
 * returnTo query parameter so login bounces straight back.
 */
const AuthRequired = () => {
  const { registrationEnabled } = useSettings();
  const location = useLocation();

  const returnTo = encodeURIComponent(
    location.pathname + location.search,
  );

  return (
    <div className={styles['auth-required']}>
      <div className={styles['auth-required-card']}>
        <Lock size={32} weight="duotone" aria-hidden="true" />
        <h1>Private Grader</h1>
        <p>
          This site is available to registered users only.
          Log in to access problems, contests, and submissions.
        </p>
        <div className={styles.actions}>
          <Link className="button button-primary" to={`/login?returnTo=${returnTo}`}>
            Log in
          </Link>
          {registrationEnabled && (
            <Link className="button button-secondary" to="/register">
              Create account
            </Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default AuthRequired;
