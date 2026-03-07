import { useScoreboard } from '../../hooks/useScoreboard';
import ScoreboardTable from '../../features/scoreboard/ScoreboardTable';
import styles from './Scoreboard.module.css';

const Scoreboard = () => {
  const { scoreboard, loading, error } = useScoreboard();

  if (loading) return <div>Loading scoreboard...</div>;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['scoreboard-container']}>
      <h1>Scoreboard</h1>
      <ScoreboardTable scoreboard={scoreboard} />
    </div>
  );
};

export default Scoreboard;
