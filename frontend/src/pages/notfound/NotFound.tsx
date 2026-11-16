import { Link, useLocation } from 'react-router-dom';
import { Button } from '../../components/ui';
import { useCommandPalette } from '../../components/shell/CommandPaletteContext';
import styles from './NotFound.module.css';
import { shortcutLabel } from '../../utils/shortcuts';

/** Catch-all for URLs that match no route (§7.10): the path asked for, a way home, and search. */
const NotFound = () => {
  const { pathname } = useLocation();
  const { open } = useCommandPalette();
  return (
    <section className={styles.notFound} aria-labelledby="not-found-title">
      <p className={styles.code} aria-hidden="true">404</p>
      <h1 id="not-found-title" className={styles.title}>Page not found</h1>
      <p className={styles.message}>
        Nothing lives at <code className={styles.path}>{pathname}</code>
      </p>
      <div className={styles.actions}>
        <Link to="/" className={styles.homeLink}>Go home</Link>
        <Button variant="secondary" onClick={open} aria-label="Search for a page">
          Search <kbd className={styles.kbd} aria-hidden="true">{shortcutLabel('K')}</kbd>
        </Button>
      </div>
    </section>
  );
};

export default NotFound;
