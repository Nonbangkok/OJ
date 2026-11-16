import { useScoreboard } from '../../hooks/useScoreboard';
import ScoreboardTable from '../../features/scoreboard/ScoreboardTable';
import styles from './Scoreboard.module.css';
import LoadingPage from '../../components/shared/LoadingPage';
import { PageHeader } from '../../components/ui';

const Scoreboard = () => {
  const { scoreboard, loading, error } = useScoreboard();

  if (loading) return <LoadingPage />;
  if (error) return <div className="error-message">{error}</div>;

  return (
    <div className={styles['scoreboard-container']}>
      <PageHeader title="Ranking" />
      <ScoreboardTable scoreboard={scoreboard} />
    </div>
  );
};

export default Scoreboard;
