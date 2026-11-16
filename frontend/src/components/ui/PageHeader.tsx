import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CaretRight } from '@phosphor-icons/react';
import styles from './PageHeader.module.css';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: Array<{ label: string; to?: string }>;
  tabs?: ReactNode;
}

/** The one page-title pattern: breadcrumb, H1, description/meta, right-aligned actions, optional tabs. */
export function PageHeader({ title, description, meta, actions, breadcrumb, tabs }: PageHeaderProps) {
  return (
    <header className={styles.header}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
          {breadcrumb.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className={styles.crumb}>
              {index > 0 && <CaretRight size={12} aria-hidden="true" className={styles.sep} />}
              {crumb.to ? <Link to={crumb.to}>{crumb.label}</Link> : <span aria-current="page">{crumb.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className={styles.row}>
        <div className={styles.text}>
          <h1 className={styles.title}>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
          {meta && <div className={styles.meta}>{meta}</div>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
      {tabs && <div className={styles.tabs}>{tabs}</div>}
    </header>
  );
}

export default PageHeader;
