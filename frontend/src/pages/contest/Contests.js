import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import styles from './Contests.module.css';
import { useContests } from '../../hooks/useContests';
import ContestList from '../../features/contest/ContestList';

const Contests = () => {
  const { user } = useAuth();
  const { contests, loading, error, joinContest } = useContests();

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading contests...</div>
      </div>
    );
  }

  if (error && contests.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h3>Error: {error}</h3>
          <Link to="/" className={styles.backLink}>
            ← Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Contests</h1>
      </div>

      {error && (
        <div className={styles.error}>
          ⚠️ {error}
        </div>
      )}

      <ContestList
        contests={contests}
        user={user}
        onJoin={joinContest}
      />
    </div>
  );
}

export default Contests;
