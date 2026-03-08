import { useEffect } from 'react';
import styles from './ProblemDetail.module.css';
import CodeSubmissionForm from '../../features/problem/submission/CodeSubmissionForm';
import Submissions from '../submission/Submissions';
import problemService from '../../services/problemService';
import { useProblemDetail } from '../../hooks/useProblemDetail';
import { generateResultString, getStatusClass } from '../../utils/formatters';

const ProblemDetail = () => {
  const {
    problemId,
    contestId,
    problem,
    contest,
    loading,
    error,
    hiddenProblemInfo,
    activeView,
    setActiveView,
    navRef,
    sliderStyle,
    handleMouseEnter,
    resetSlider
  } = useProblemDetail();

  useEffect(() => {
    // Delay to ensure DOM is ready for measurement
    const timer = setTimeout(() => {
      resetSlider();
    }, 150);
    return () => clearTimeout(timer);
  }, [activeView, problem]); // Recalculate on view or problem change

  const handlePdfView = () => {
    if (!problem || !problem.has_pdf) return;
    const pdfUrl = problemService.getPdfUrl(problemId, contestId);
    window.open(pdfUrl, '_blank');
  };



  if (loading) return <div>Loading...</div>;
  if (error) return <div className={styles['error-message']}>{error}</div>;
  if (hiddenProblemInfo) {
    return (
      <div className={styles['problem-detail-container']}>
        <div className={styles['hidden-problem-container']}>
          <div className={styles['hidden-problem-header']}>
            <h2>Problem is hidden by Admin</h2>
            <div className={styles['hidden-problem-info']}>
              <p><strong>Problem ID:</strong> {hiddenProblemInfo.problemId}</p>
              <p><strong>Title:</strong> {hiddenProblemInfo.title}</p>
            </div>
          </div>
          <div className={styles['hidden-problem-message']}>
            <p>{hiddenProblemInfo.detail}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!problem) return <div className={styles['error-message']}>Problem not found.</div>;



  const renderContent = () => {
    switch (activeView) {
      case 'statement':
        return (
          <div className={styles['statement-view']}>
            {problem.has_pdf ? (
              <iframe
                src={contestId ? `/api/contests/${contestId}/problems/${problemId}/pdf` : `/api/problems/${problemId}/pdf`}
                title={`${problem.title} PDF`}
                className={styles['pdf-preview']}
              />
            ) : (
              <div className={styles['no-pdf-message']}>No PDF available for preview.</div>
            )}
          </div>
        );
      case 'submit':
        return (
          <div className={styles['submit-view']}>
            <CodeSubmissionForm problemId={problemId} contestId={contestId} />
          </div>
        );
      case 'submissions':
        // Pass contestId to submissions component if it exists
        return (
          <div className={styles['submissions-wrapper']}>
            <Submissions problemId={problemId} contestId={contestId} showTitle={false} />
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div className={styles['problem-detail-container']}>
      <div className={styles['content-wrapper']}>
        <div className={styles['left-nav']}>
          <div className={styles['problem-info']}>
            <h2>{problem.title}</h2>
            <p className={styles['problem-id']}>{problem.id}</p>
            {problem.author && <p className={styles['problem-author']}>Author: {problem.author}</p>}

            <div className={styles['problem-meta']}>
              <span>Time Limit: {problem.time_limit_ms} ms</span>
              <span>Memory Limit: {problem.memory_limit_mb} MB</span>
            </div>

            {problem.has_pdf && (
              <button
                onClick={handlePdfView}
                className={styles['view-pdf-btn']}
              >
                View Problem PDF
              </button>
            )}
          </div>
          <nav ref={navRef} className={styles['problem-nav']} onMouseLeave={resetSlider}>
            <div className={styles.slider} style={sliderStyle} />
            <button
              className={`${styles['nav-btn']} ${activeView === 'statement' ? styles.active : ''}`}
              onClick={() => setActiveView('statement')}
              onMouseEnter={handleMouseEnter}
            >
              Statement
            </button>
            <button
              className={`${styles['nav-btn']} ${activeView === 'submit' ? styles.active : ''}`}
              onClick={() => setActiveView('submit')}
              onMouseEnter={handleMouseEnter}
            >
              Submit
            </button>
            <button
              className={`${styles['nav-btn']} ${activeView === 'submissions' ? styles.active : ''}`}
              onClick={() => setActiveView('submissions')}
              onMouseEnter={handleMouseEnter}
            >
              My Submissions
            </button>
          </nav>
          {problem && typeof problem.best_score !== 'undefined' && (
            <div className={styles['score-container']}>
              <div className={styles['score-bar-container']}>
                <div
                  className={`${styles['score-bar']} ${problem.best_score === 100 ? styles.full : problem.best_score > 0 ? styles.partial : styles.zero
                    }`}
                  style={{ width: `${problem.best_score || 0}%` }}
                ></div>
              </div>
              <div className={styles['score-text-container']}>
                <span className={styles['score-text']}>Score: {problem.best_score || 0} / 100</span>
                <span className={styles['result-string']}>
                  {generateResultString(problem.best_submission_status, problem.best_submission_results)}
                </span>
              </div>
              {problem.best_submission_status && (
                <div className={`${styles['status-text']} ${styles[getStatusClass(problem.best_submission_status)]}`}>
                  {problem.best_submission_status}
                </div>
              )}
            </div>
          )}
        </div>
        <div className={styles['right-content']}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default ProblemDetail; 