import { Link } from 'react-router-dom';
import styles from './NotFound.module.css';

/** Catch-all page for URLs that match no route. */
const NotFound = () => (
  <section className={styles.notFound} aria-labelledby="not-found-title">
    <p className={styles.code}>404</p>
    <h1 id="not-found-title" className={styles.title}>Page not found</h1>
    <p className={styles.message}>The page you are looking for does not exist or has moved.</p>
    <Link to="/" className={styles.homeLink}>Back to home</Link>
  </section>
);

export default NotFound;
