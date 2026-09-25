import { useParams, Link } from 'react-router-dom';
import useContestScoreboard from '../../hooks/useContestScoreboard';
import UserAvatar from '../../components/user/UserAvatar';
import styles from './ContestScoreboard.module.css';
import shared from '../../components/styles/ContestPages.module.css';
import tableStyles from '../../components/styles/Table.module.css';
import LoadingPage from '../../components/shared/LoadingPage';
import { useAuth } from '../../context/AuthContext';
import { formatDateTime } from '../../utils/formatters';

const ContestScoreboard = () => {
  const { contestId } = useParams();
  const { user } = useAuth();

  const {
    contest,
    scoreboard,
    problems,
    loading,
    error,
    lastUpdate,
    getProblemScore
  } = useContestScoreboard(contestId);

  // Compact "Updated 01:11" — the verbose timestamp is unnecessary here.
  const formatUpdated = (value: Date) =>
    formatDateTime(value, { month: undefined, day: undefined, year: undefined });

  if (loading) return <LoadingPage />;

  if (error) {
    return (
      <div className={shared.error}>
        <h3 className={shared.errorTitle}>Error: {error}</h3>
        <Link to="/contests" className={shared.backLink}>
          ← Back to Contests
        </Link>
      </div>
    );
  }

  return (
    <div className={shared.page}>
      <div className={shared.pageHeader}>
        <h1 className={shared.pageTitle}>Contest Scoreboard</h1>
        {lastUpdate && contest?.status !== 'finished' && (
          <span className={shared.pageAside}>Updated {formatUpdated(lastUpdate)}</span>
        )}
      </div>

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
                <th className={styles.colRank}>Rank</th>
                <th className={styles.colParticipant}>Participant</th>
                <th className={styles.colTotal}>Score</th>
                {problems.map((problem) => (
                  <th key={problem.problem_id ?? problem.id} className={styles.colProblem}>
                    <span className={styles.problemId}>
                      {problem.problem_id ?? problem.id}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scoreboard.map((participant, index) => {
                const rank = index + 1;
                const isCurrentUser = user?.username === participant.username;
                return (
                  <tr
                    key={participant.user_id ?? `${participant.username}-${index}`}
                    className={[
                      rank <= 3 ? styles[`rank${rank}`] : '',
                      isCurrentUser ? styles.currentUser : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <td className={styles.colRank}>{rank}</td>
                    <td className={styles.colParticipant}>
                      <span className={styles['user-cell']}>
                        <UserAvatar
                          username={participant.username}
                          hasAvatar={participant.has_avatar}
                          size={24}
                        />
                        {participant.username}
                      </span>
                    </td>
                    <td className={styles.colTotal}>
                      <span className={styles.totalScore}>{participant.total_score}</span>
                    </td>
                    {problems.map((problem) => {
                      const problemId = problem.problem_id ?? problem.id;
                      const problemScore = getProblemScore(
                        participant.detailed_scores,
                        problemId
                      );

                      return (
                        <td key={problemId} className={styles.colProblem}>
                          {problemScore ? (
                            <span
                              className={[
                                styles.score,
                                problemScore.solved ? styles.solved : '',
                                problemScore.score > 0 && !problemScore.solved ? styles.partial : '',
                              ].filter(Boolean).join(' ')}
                            >
                              {problemScore.score}
                            </span>
                          ) : (
                            <span className={styles.noAttempt}>—</span>
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
