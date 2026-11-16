import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import styles from './ProblemDetail.module.css';
import CodeSubmissionForm from '../../features/problem/submission/CodeSubmissionForm';
import SubmissionResult from '../../features/submission/SubmissionResult';
import useLiveSubmission from '../../features/submission/useLiveSubmission';
import Submissions from '../submission/Submissions';
import problemService from '../../services/problemService';
import { useProblemDetail } from '../../hooks/useProblemDetail';
import { EmptyState, InlineError, InlineNotice, PageHeader, ScoreCell, TestcaseStrip } from '../../components/ui';
import LoadingPage from '../../components/shared/LoadingPage';
import type { ProblemDetail as ProblemDetailModel } from '../../types';

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
  const { problemId, contestId, problem, contest, loading, error } = useProblemDetail();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'statement';
  const submissionParam = Number(searchParams.get('submission'));
  const submissionId = Number.isSafeInteger(submissionParam) && submissionParam > 0 ? submissionParam : null;
  const { submission, error: resultError } = useLiveSubmission(submissionId, contestId);

  const selectTab = (next: Tab) => {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      if (next === 'statement') params.delete('tab'); else params.set('tab', next);
      return params;
    }, { replace: true });
  };
  const showResult = (id: number) => {
    setSearchParams((previous) => {
      const params = new URLSearchParams(previous);
      params.set('tab', 'submit');
      params.set('submission', String(id));
      return params;
    }, { replace: true });
  };

  if (loading) return <LoadingPage />;
  if (error) return <div className={styles['error-message']}>{error}</div>;
  if (!problem || !problemId) return <div className={styles['error-message']}>Problem not found.</div>;

  const pdfUrl = problemService.getPdfUrl(problemId, contestId);
  const submissionsBase = contestId ? `/contests/${contestId}/submissions` : '/submissions';
  const breadcrumb = contestId
    ? [{ label: contest?.title ?? 'Contest', to: `/contests/${contestId}` }]
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
        title={problem.title}
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
            <CodeSubmissionForm
              problemId={problemId}
              contestId={contestId}
              submissionFilename={problem.submission_filename}
              onSubmitted={showResult}
            />
            {resultError && <InlineError message={resultError} />}
            {submission && (
              <SubmissionResult
                submission={submission}
                limits={{
                  timeMs: submission.time_limit_ms ?? problem.time_limit_ms,
                  memoryMb: submission.memory_limit_mb ?? problem.memory_limit_mb,
                }}
                actions={(
                  <>
                    <Link to={`${submissionsBase}/${submission.id}`} className={styles.action}>View submitted code</Link>
                    <button type="button" className={styles.action} onClick={() => document.getElementById('code')?.focus()}>Edit &amp; resubmit</button>
                  </>
                )}
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
