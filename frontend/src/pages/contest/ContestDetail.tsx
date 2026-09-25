import { Link, useParams } from 'react-router-dom';
import styles from './ContestDetail.module.css';
import shared from '../../components/styles/ContestPages.module.css';
import { formatDateTime } from '../../utils/formatters';
import StatusBadge from '../../components/shared/StatusBadge';
import useContestDetail from '../../hooks/useContestDetail';
import { useProblems } from '../../hooks/useProblems';
import LoadingPage from '../../components/shared/LoadingPage';
import type { ProblemSummary } from '../../types';

/** Humanized countdown without a suffix, e.g. "1d 7h 37m". Mirrors the
 *  Home page's contest countdown so the two never drift in format. */
const formatCountdown = (target: string): string => {
  const diff = new Date(target).getTime() - Date.now();
  if (diff <= 0) return 'Soon';

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (days === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
};

/** A problem counts as solved at a full 100 best score — the same bar the
 *  contest problems table uses for its "Solved" status. */
const isSolved = (problem: ProblemSummary): boolean =>
  Number(problem.best_score ?? 0) === 100;

const ContestDetail = () => {
  const { contestId } = useParams();
  const {
    contest,
    loading,
    error,
    joining,
    handleJoinContest
  } = useContestDetail();

  // Per-user progress comes from the contest problems endpoint (best_score /
  // submission_count per problem). Only needed once the user is in a running
  // contest they can actually see problems for.
  const canTrackProgress = Boolean(
    contest && contest.status === 'running' && contest.is_participant
  );
  const { problems: progressProblems } = useProblems(
    contestId ?? null,
    canTrackProgress
  );

  if (loading) return <LoadingPage />;

  if (error || !contest) {
    return (
      <div className={shared.error}>
        <h3 className={shared.errorTitle}>{error || 'Contest not found'}</h3>
        <Link to="/contests" className={shared.backLink}>
          ← Back to Contests
        </Link>
      </div>
    );
  }

  const problemCount = contest.problems?.length ?? 0;
  const showJoin = !contest.is_participant && contest.status !== 'finished';

  // Progress over the fetched per-user summaries. `problems` is typed as an
  // array, but a failed/aborted fetch can land null in it — fall back to an
  // empty list instead of crashing the page.
  const summaries: ProblemSummary[] = Array.isArray(progressProblems)
    ? (progressProblems as ProblemSummary[])
    : [];
  const solvedCount = canTrackProgress ? summaries.filter(isSolved).length : 0;
  const totalScore = canTrackProgress
    ? summaries.reduce((sum, problem) => sum + Number(problem.best_score ?? 0), 0)
    : 0;

  // The top-right slot carries the one timing fact that matters right now:
  // remaining time while running, starts-in while scheduled, ended time once
  // finished.
  const topRightTiming =
    contest.status === 'running' ? (
      <>
        {formatCountdown(contest.end_time)} remaining
      </>
    ) : contest.status === 'scheduled' ? (
      <>
        Starts in {formatCountdown(contest.start_time)}
      </>
    ) : contest.status === 'finishing' ? (
      <>
        {formatCountdown(contest.end_time)} remaining
      </>
    ) : (
      <>
        Ended {formatDateTime(contest.end_time)}
      </>
    );

  const showProgressBar =
    contest.status === 'running' && problemCount > 0 && !showJoin;
  const solvedPercent = problemCount > 0 ? (solvedCount / problemCount) * 100 : 0;

  return (
    <div className={styles.container}>
      {/* Identity and the live timing fact share the top row: title + status
         on the left, the countdown (or ended time) anchored right. */}
      <div className={styles.top}>
        <div className={styles.header}>
          <h1 className={styles.title}>{contest.title}</h1>
          <StatusBadge status={contest.status} />
        </div>
        <p className={styles.topTiming}>{topRightTiming}</p>
      </div>

      {contest.description && (
        <p className={styles.description}>{contest.description}</p>
      )}

      {/* Secondary metadata: the schedule window, then one compact line of
         counts. */}
      <p className={styles.schedule}>
        {formatDateTime(contest.start_time)} → {formatDateTime(contest.end_time)}
      </p>
      <div className={styles.meta}>
        {problemCount > 0 && (
          <span className={styles.metaItem}>
            {problemCount} problem{problemCount === 1 ? '' : 's'}
          </span>
        )}
        {problemCount > 0 && (
          <span className={styles.metaDot} aria-hidden="true">·</span>
        )}
        <span className={styles.metaItem}>
          {contest.participant_count || 0} participant{Number(contest.participant_count) === 1 ? '' : 's'}
        </span>
      </div>

      {/* Progress / action, separated from the facts above by whitespace
         only. What renders here follows the contest state: join →
         registration note (scheduled) → live progress (running) →
         scoreboard (finished). */}
      {showJoin ? (
        <div className={styles.actionBlock}>
          <button onClick={handleJoinContest} disabled={joining} className={styles.joinButton}>
            {joining ? 'Joining...' : 'Join Contest'}
          </button>
        </div>
      ) : contest.status === 'running' ? (
        <div className={styles.actionBlock}>
          <p className={styles.progressLabel}>Your progress</p>
          <p className={styles.progressStats}>
            {problemCount > 0 ? (
              <>
                <span className={styles.progressSolved}>
                  {solvedCount} / {problemCount} solved
                </span>
                <span className={styles.progressDot} aria-hidden="true">·</span>
                <span className={styles.progressScore}>{totalScore} points</span>
              </>
            ) : (
              <span className={styles.progressSolved}>Problems coming soon</span>
            )}
          </p>
          <div className={styles.progressRow}>
            {showProgressBar && (
              <span
                className={styles.progressBar}
                role="progressbar"
                aria-label={`Problems solved: ${solvedCount} of ${problemCount}`}
                aria-valuemin={0}
                aria-valuemax={problemCount}
                aria-valuenow={solvedCount}
              >
                <span
                  className={styles.progressFill}
                  style={{ width: `${solvedPercent}%` }}
                />
              </span>
            )}
            <Link
              to={`/contests/${contest.id}/problems`}
              className={styles.primaryAction}
            >
              {solvedCount > 0 ? 'Continue Solving' : 'Start Solving'}
            </Link>
          </div>
        </div>
      ) : contest.status === 'scheduled' ? (
        <p className={styles.waitingNote}>
          You are registered. The contest starts {formatDateTime(contest.start_time)} — check back then.
        </p>
      ) : (
        <div className={styles.actionBlock}>
          <Link to={`/contests/${contest.id}/scoreboard`} className={styles.primaryAction}>
            View Scoreboard
          </Link>
        </div>
      )}
    </div>
  );
}

export default ContestDetail;
