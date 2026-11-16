import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import styles from './ProblemDetail.module.css';
import CodeSubmissionForm from '../../features/problem/submission/CodeSubmissionForm';
import Submissions from '../submission/Submissions';
import problemService from '../../services/problemService';
import { useProblemDetail } from '../../hooks/useProblemDetail';
import { EmptyState, InlineNotice, PageHeader, ScoreCell, TestcaseStrip } from '../../components/ui';
import LoadingPage from '../../components/shared/LoadingPage';
import type { ProblemDetail as ProblemDetailModel } from '../../types';
import { useContest } from '../../features/contest/ContestContext';
import { problemLetter } from '../../features/contest/letters';
import { useCountdown } from '../../components/shell/useCountdown';

type Tab = 'statement' | 'submit' | 'submissions';
const TABS: Tab[] = ['statement', 'submit', 'submissions'];

const languagesLine = (problem: ProblemDetailModel) =>
  problem.problem_type === 'header' && problem.submission_filename
    ? `C++ · submit ${problem.submission_filename}`
    : 'C++ · Python';

/**
 * Statement tab: the PDF at content width with a loading line. Browsers fire
 * no error event for a PDF that will not render inline, so the open-PDF
 * fallback is always offered under the frame.
 */
function Statement({ problem, pdfUrl }: { problem: ProblemDetailModel; pdfUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  if (!problem.has_pdf) {
    return <EmptyState title="No statement yet." description="This problem has no PDF statement." />;
  }
  return (
    <div className={styles.statement}>
      {!loaded && <p className={styles.loading} role="status">Loading statement…</p>}
      <iframe
        src={pdfUrl}
        title={`${problem.title} statement`}
        className={styles.pdf}
        onLoad={() => setLoaded(true)}
      />
      <p className={styles.fallback}>
        Can&apos;t preview it here? <a href={pdfUrl} target="_blank" rel="noreferrer">open PDF</a>
      </p>
    </div>
  );
}

const ProblemDetail = () => {
  const { problemId, contestId, problem, contest: fetchedContest, loading, error } = useProblemDetail();
  // Under ContestLayout the contest (and its ordered problem list) comes from context.
  const { contest: layoutContest } = useContest();
  const contest = contestId ? (layoutContest ?? fetchedContest) : null;
  const endClock = useCountdown(contest?.status === 'running' ? contest.end_time : null);
  // Submissions close at end_time by the client clock, without waiting for the server (§7.7).
  const contestClosed = Boolean(contest) && (
    contest?.status === 'finishing' || contest?.status === 'finished' || (contest?.status === 'running' && endClock.done)
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'statement';
  const submissionParam = Number(searchParams.get('submission'));
  const legacySubmissionId = Number.isSafeInteger(submissionParam) && submissionParam > 0 ? submissionParam : null;
  const navigate = useNavigate();

  const selectTab = (next: Tab) => {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      if (next === 'statement') params.delete('tab'); else params.set('tab', next);
      return params;
    }, { replace: true });
  };
  // A new submission opens its own page, which follows the verdict live.
  const submissionsRoot = contestId ? `/contests/${contestId}/submissions` : '/submissions';
  const showResult = (id: number) => navigate(`${submissionsRoot}/${id}`);

  // Links from before (…?tab=submit&submission=N) go to the submission page.
  if (legacySubmissionId) return <Navigate to={`${submissionsRoot}/${legacySubmissionId}`} replace />;
  if (loading) return <LoadingPage />;
  if (error) return <div className={styles['error-message']}>{error}</div>;
  if (!problem || !problemId) return <div className={styles['error-message']}>Problem not found.</div>;

  const pdfUrl = problemService.getPdfUrl(problemId, contestId);
  const letterIndex = contest?.problems?.findIndex((p) => p.id === problemId) ?? -1;
  const letter = letterIndex >= 0 ? problemLetter(letterIndex) : null;
  const breadcrumb = contestId
    ? [{ label: contest?.title ?? 'Contest', to: `/contests/${contestId}` }, ...(letter ? [{ label: letter }] : [])]
    : [
        { label: 'Problems', to: '/problems' },
        ...(problem.collection ? [{ label: problem.collection.name, to: `/problems?collection=${problem.collection.id}` }] : []),
      ];
  const best = problem.viewerBest;
  const bestResults = best ? best.caseStatuses.map((status) => ({ status })) : [];
  const count = problem.viewerSubmissionCount ?? 0;

  const tabs = (
    <div role="tablist" aria-label="Problem sections" className={styles.tabs}>
      {TABS.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          className={styles.tab}
          onClick={() => selectTab(key)}
        >
          {key === 'statement' ? 'Statement' : key === 'submit' ? 'Submit' : `Submissions ${count}`}
        </button>
      ))}
    </div>
  );

  return (
    <div className={styles['problem-detail-container']}>
      <PageHeader
        breadcrumb={breadcrumb}
        title={letter ? <><span className={styles.letter}>{letter}</span> {problem.title}</> : problem.title}
        meta={(
          <span className={styles.meta}>
            <span className={styles.mono}>{problem.id}</span>
            <span>{`${problem.time_limit_ms} ms · ${problem.memory_limit_mb} MB`}</span>
            <span>{languagesLine(problem)}</span>
            {problem.author && (
              <Link to={`/problems?author=${encodeURIComponent(problem.author)}`} className={styles.author}>{problem.author}</Link>
            )}
          </span>
        )}
        actions={(
          <>
            {best && (
              <span className={styles.best}>
                {bestResults.length > 0 && <TestcaseStrip results={bestResults} />}
                <ScoreCell score={best.score} attempted />
              </span>
            )}
            {problem.has_starter_files && (
              <a href={problemService.getStarterUrl(problemId, contestId)} download className={styles.action}>Starter</a>
            )}
            {problem.has_pdf && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className={styles.action}>Open PDF</a>
            )}
          </>
        )}
        tabs={tabs}
      />

      {problem.is_visible === false && (
        <InlineNotice tone="warning">This problem is currently hidden — it is only visible to staff.</InlineNotice>
      )}

      <div role="tabpanel" aria-label={tab} className={styles.panel}>
        {tab === 'statement' && <Statement problem={problem} pdfUrl={pdfUrl} />}
        {tab === 'submit' && (
          <>
            {contestClosed ? (
              <InlineNotice title="Contest ended — submissions closed.">
                This problem returns to the practice set once judging finishes.
              </InlineNotice>
            ) : (
              <CodeSubmissionForm
                problemId={problemId}
                contestId={contestId}
                submissionFilename={problem.submission_filename}
                onSubmitted={showResult}
              />
            )}
          </>
        )}
        {tab === 'submissions' && <Submissions problemId={problemId} contestId={contestId} showTitle={false} />}
      </div>
    </div>
  );
};

export default ProblemDetail;
