import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../../components/ui';
import styles from './AuthoringHub.module.css';

export type AuthoringHubTab = 'drafts' | 'profiles' | 'ai-docs';

const TABS: Array<{ key: AuthoringHubTab; label: string; to: string }> = [
  { key: 'drafts', label: 'Drafts', to: '/admin/authoring' },
  { key: 'profiles', label: 'Author profiles', to: '/admin/authoring/profiles' },
  { key: 'ai-docs', label: 'AI docs', to: '/admin/authoring/ai-docs' },
];

/** The Authoring page header (§7.9): title, one primary, sub-tabs Drafts · Author profiles · AI docs. */
export default function AuthoringHub({ tab, meta, actions, children }: {
  tab: AuthoringHubTab;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.hub}>
      <PageHeader
        breadcrumb={[{ label: 'Manage' }]}
        title="Authoring"
        meta={meta}
        actions={actions}
        tabs={(
          <nav className={styles.tabs} aria-label="Authoring sections">
            {TABS.map((t) => (
              <Link key={t.key} to={t.to} className={t.key === tab ? styles.tabActive : styles.tab} aria-current={t.key === tab ? 'page' : undefined}>
                {t.label}
              </Link>
            ))}
          </nav>
        )}
      />
      {children}
    </section>
  );
}
