import { useParams, Link } from 'react-router-dom';
import useContestScoreboard from '../../hooks/useContestScoreboard';
import styles from './ContestScoreboard.module.css';
import tableStyles from '../../components/styles/Table.module.css';

const ContestScoreboard = () => {
  const { contestId } = useParams();

  const {
    contest,
    scoreboard,
    problems,
    loading,
    error,
    lastUpdate,
    formatDateTime,
    getProblemScore
  } = useContestScoreboard(contestId);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading contest rankings...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h3>Error: {error}</h3>
          <Link to="/contests" className={styles.backLink}>
            ← Back to Contests
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h1>Contest Scoreboard</h1>
      {lastUpdate && contest?.status !== 'finished' && (
        <div className={styles.refreshInfo}>
          <p>Last updated: {formatDateTime(lastUpdate)}</p>
        </div>
      )}

      {scoreboard.length === 0 ? (
        <div className={styles.noData}>
          <h3>No ranking data yet</h3>
          <p>No participants have submitted solutions in this contest yet</p>
        </div>
      ) : (
        <div className={tableStyles['table-container']}>
          <table className={`${tableStyles.table} ${styles.scoreboardTable}`}>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Participant</th>
                <th>Total Score</th>
                {problems.map((problem) => (
                  <th key={problem.problem_id}>
                    <div className={styles.problemHeader}>
                      <div className={styles.problemId}>{problem.problem_id}</div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoreboard.map((participant, index) => {
                const rank = index + 1;
                return (
                  <tr key={participant.user_id} className={rank <= 3 ? `rank-${rank}` : ''}>
                    <td>{rank}</td>
                    <td>{participant.username}</td>
                    <td>{participant.total_score}</td>
                    {problems.map((problem) => {
                      const problemScore = getProblemScore(
                        participant.detailed_scores,
                        problem.problem_id
                      );

                      return (
                        <td key={problem.problem_id}>
                          {problemScore ? (
                            <div
                              className={`${styles.problemScore} ${problemScore.solved
                                ? styles.solved
                                : problemScore.score > 0
                                  ? styles.partial
                                  : ''
                                }`}
                            >
                              <span className={styles.score}>{problemScore.score}</span>
                            </div>
                          ) : (
                            <div className={styles.noAttempt}>-</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ContestScoreboard; 