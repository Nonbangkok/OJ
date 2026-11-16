import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import GraderLogo from '../brand/GraderLogo';
import styles from './AuthShell.module.css';

/** Login / register: the logo and one narrow column, no sidebar. */
export default function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <Link to="/" className={styles.brand}>
        <GraderLogo size={28} title="" />
        <span>Grader</span>
      </Link>
      <main className={styles.column}>{children}</main>
    </div>
  );
}
