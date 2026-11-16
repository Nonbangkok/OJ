import { Link, Navigate, useParams } from 'react-router-dom';
import { InlineError, InlineNotice, PageHeader, StatusMark, TestcaseStrip, type VerdictTone } from '../../components/ui';
import LoadingPage from '../../components/shared/LoadingPage';
import { useContest } from '../../features/contest/ContestContext';
import { problemLetter } from '../../features/contest/letters';
import { useProblems } from '../../hooks/useProblems';
import type { ProblemSummary } from '../../types';
import styles from '../../features/contest/ContestStates.module.css';

const FULL = 100;

const markFor = (problem: ProblemSummary): VerdictTone => {
  if (Number(problem.submission_count ?? 0) === 0 || problem.best_score == null) return 'none';
  return Number(problem.best_score) >= FULL ? 'pass' : 'fail';
};

/** A participant's contest problems (§7.7): letter, title, best strip, score, tries; points of max in the header. */
const ContestProblems = () => {
  const { contestId = '' } = useParams();
  const { contest } = useContest();
  const active = Boolean(contest?.is_participant) && (contest?.status === 'running' || contest?.status === 'finishing');
  const { problems, loading, error } = useProblems(contestId, active);

  if (!contest) return null;
  // Not in it (or not running any more): /contests/:id shows the join gate, lobby or recap.
  if (!active) return <Navigate to={`/contests/${contestId}`} replace />;
  if (loading) return <LoadingPage />;

  const rows = problems as ProblemSummary[];
  const points = rows.reduce((sum, p) => sum + Number(p.best_score ?? 0), 0);

  return (
    <div className={styles.page}>
      <PageHeader title="Problems" meta={`${contest.title} · ${points} / ${rows.length * FULL} points`} />
      {contest.status === 'finishing' && (
        <div role="status">
          <InlineNotice title="Judging final submissions…">Results and the final scoreboard appear when the last submission is judged.</InlineNotice>
        </div>
      )}
      {error && <InlineError message={error} />}
      <table className={styles.table} aria-label="Problems">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Problem</th>
            <th scope="col">Best</th>
            <th scope="col" className={styles.right}>Score</th>
            <th scope="col" className={styles.right}>Tries</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((problem, i) => {
            const tries = Number(problem.submission_count ?? 0);
            const strip = (problem.best_submission_results ?? []).map((r) => ({ status: r.status }));
            const tone = markFor(problem);
            return (
              <tr key={problem.id}>
                <td className={styles.letter}>{problemLetter(i)}</td>
                <td>
                  <span className={styles.problemCell}>
                    <StatusMark tone={tone} />
                    <Link to={`/contests/${contestId}/problems/${problem.id}`} className={styles.problemLink}>{problem.title}</Link>
                  </span>
                </td>
                <td>{strip.length > 0 ? <TestcaseStrip results={strip} /> : <span className={styles.muted}>—</span>}</td>
                <td className={`${styles.right} ${styles.mono} ${tone === 'pass' ? styles.full : ''}`}>{tries > 0 && problem.best_score != null ? problem.best_score : '—'}</td>
                <td className={`${styles.right} ${styles.mono} ${styles.muted}`}>{tries > 0 ? tries : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ContestProblems;
