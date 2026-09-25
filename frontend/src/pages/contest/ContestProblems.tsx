import { useParams, Link } from 'react-router-dom';
import { useContestGuard } from '../../hooks/useContestGuard';
import { useProblems } from '../../hooks/useProblems';
import styles from './ContestProblems.module.css';
import shared from '../../components/styles/ContestPages.module.css';
import tableStyles from '../../components/styles/Table.module.css';
import { StatusBadge } from '../../components/ui';
import LoadingPage from '../../components/shared/LoadingPage';
import type { ProblemSummary } from '../../types';

/** User-centric status for a contest problem row. "New" was ambiguous —
 *  these three states say what the user has (or hasn't) done. */
type UserProgress = {
  label: string;
  tone: 'neutral' | 'success' | 'warning';
  action: string;
};

const getProgress = (problem: ProblemSummary): UserProgress => {
  const attempts = Number(problem.submission_count ?? 0);
  const best = Number(problem.best_score ?? 0);

  if (attempts > 0 && best === 100) {
    return { label: 'Solved', tone: 'success', action: 'View' };
  }
  if (attempts > 0) {
    return { label: 'Attempted', tone: 'warning', action: 'Continue' };
  }
  return { label: 'Unsolved', tone: 'neutral', action: 'Solve' };
};

const ContestProblems = () => {
  const { contestId } = useParams();

  // Contest access guard — handles redirect logic and polling
  const { isAccessible, loading: guardLoading, error: guardError } = useContestGuard(contestId);

  // Fetch contest problems using the shared hook
  const { problems, loading: problemsLoading, error: problemsError } = useProblems(
    contestId ?? null,
    isAccessible,
  );

  if (!contestId) {
    return <div className="error-message">Error: No Contest ID specified in the URL.</div>;
  }

  if (guardLoading || problemsLoading) return <LoadingPage />;
  if (guardError) return <div className="error-message">{guardError}</div>;
  if (problemsError) return <div className="error-message">{problemsError}</div>;

  return (
    <div className={shared.page}>
      <div className={shared.pageHeader}>
        <h1 className={shared.pageTitle}>Contest Problems</h1>
      </div>

      {problems.length === 0 ? (
        <div className={styles.empty}>
          <h3>No problems available</h3>
          <p>Problems will appear here once the contest begins.</p>
        </div>
      ) : (
        <div className={tableStyles['table-container']}>
          <table className={`${tableStyles.table} ${styles.contestTable}`}>
            <thead>
              <tr>
                <th className={styles.colProblem}>Problem</th>
                <th className={styles.colStatus}>Status</th>
                <th className={styles.colScore}>Score</th>
                <th className={styles.colAttempts}>Attempts</th>
                <th className={styles.colAction}>Action</th>
              </tr>
            </thead>
            <tbody>
              {problems.map((problem) => {
                const summary = problem as ProblemSummary;
                const attempts = Number(summary.submission_count ?? 0);
                const best = summary.best_score;
                const progress = getProgress(summary);
                const linkPath = `/contests/${contestId}/problems/${problem.id}`;

                return (
                  <tr key={problem.id}>
                    <td className={styles.colProblem}>
                      <Link to={linkPath} className={styles.problemTitle}>{problem.title}</Link>
                      <span className={styles.problemId}>{problem.id}</span>
                    </td>
                    <td className={styles.colStatus}>
                      <StatusBadge tone={progress.tone} soft>{progress.label}</StatusBadge>
                    </td>
                    <td className={styles.colScore}>
                      {attempts > 0 && best !== null && best !== undefined
                        ? best
                        : <span className={styles.noData}>—</span>}
                    </td>
                    <td className={styles.colAttempts}>
                      {attempts > 0 ? attempts : <span className={styles.noData}>—</span>}
                    </td>
                    <td className={styles.colAction}>
                      <Link to={linkPath} className={styles.actionLink}>
                        {progress.action} →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default ContestProblems;
