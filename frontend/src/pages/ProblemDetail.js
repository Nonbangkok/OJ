import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import axios from 'axios';
import styles from './ProblemDetail.module.css';
import CodeSubmissionForm from '../components/CodeSubmissionForm';
import Submissions from './Submissions';

const API_URL = process.env.REACT_APP_API_URL;

function ProblemDetail() {
  const { contestId, problemId } = useParams();
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [hiddenProblemInfo, setHiddenProblemInfo] = useState(null);
  const [activeView, setActiveView] = useState('statement');
  const [contest, setContest] = useState(null);
  const navRef = useRef(null);
  const [sliderStyle, setSliderStyle] = useState({ opacity: 0 });

  useEffect(() => {
    const fetchProblem = async () => {
      try {
        let url;
        // Determine the correct API endpoint based on the context (contest or main)
        if (contestId) {
          url = `${API_URL}/contests/${contestId}/problems/${problemId}`;
        } else {
          url = `${API_URL}/problems/${problemId}`;
        }
        
        const problemResponse = await axios.get(url, { withCredentials: true });
        const problemData = problemResponse.data;

        // For non-contest problems, we still fetch all stats to show the user's best score.
        // For contest problems, the stats are already joined in the backend.
        if (!contestId) {
          const statsResponse = await axios.get(`${API_URL}/problems-with-stats`, { withCredentials: true });
          const allProblemsWithStats = statsResponse.data;
          const currentProblemStats = allProblemsWithStats.find(p => String(p.id) === problemId);
          setProblem({ ...problemData, ...currentProblemStats });
        } else {
          setProblem(problemData);
          // Also fetch contest details for the banner
          const contestResponse = await axios.get(`${API_URL}/contests/${contestId}`, { withCredentials: true });
          setContest(contestResponse.data);
        }
        
      } catch (err) {
        if (err.response?.status === 403 && err.response?.data?.message === 'Problem is hidden') {
          setHiddenProblemInfo({
            problemId: err.response.data.problemId,
            title: err.response.data.title,
            detail: err.response.data.detail
          });
        } else if (err.response?.status === 404) {
          setError(`Problem ${problemId} not found.`);
        } else {
          setError(err.response?.data?.message || `Failed to fetch problem ${problemId}.`);
        }
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (problemId) {
      fetchProblem();
    }
  }, [problemId, contestId]);

  const handleMouseEnter = (e) => {
    const btn = e.currentTarget;
    setSliderStyle({
      height: btn.offsetHeight + 5,
      top: btn.offsetTop + 22,
      opacity: 1,
    });
  };

  const resetSlider = () => {
    try {
      const activeBtn = navRef.current?.querySelector(`.${styles.active}`);
      if (activeBtn) {
        setSliderStyle({
          height: activeBtn.offsetHeight + 5,
          top: activeBtn.offsetTop + 22,
          opacity: 1,
        });
      } else {
        setSliderStyle({ ...sliderStyle, opacity: 0 });
      }
    } catch (e) {
      setSliderStyle({ opacity: 0 });
    }
  };

  useEffect(() => {
    // Delay to ensure DOM is ready for measurement
    const timer = setTimeout(() => {
      resetSlider();
    }, 150);
    return () => clearTimeout(timer);
  }, [activeView, problem]); // Recalculate on view or problem change

  const handlePdfView = () => {
    if (!problem || !problem.has_pdf) return;
    // For contest PDFs, the backend now checks authorization, so we can link directly.
    const pdfUrl = contestId 
      ? `${API_URL}/contests/${contestId}/problems/${problemId}/pdf`
      : `${API_URL}/problems/${problemId}/pdf`;
    window.open(pdfUrl, '_blank');
  };

  const generateResultString = (status, results) => {
    if (status === 'Compilation Error') {
      return 'Compilation Error';
    }
    if (!results || results.length === 0) {
      return '';
    }
    const charMap = {
      'Accepted': 'P',
      'Wrong Answer': '-',
      'Time Limit Exceeded': 'T',
      'Runtime Error': 'R',
      'Memory Limit Exceeded': 'M',
      'Skipped': 'S',
    };
    const resultChars = results.map(r => charMap[r.status] || '?').join('');
    return `[${resultChars}]`;
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

  const getStatusClass = (status) => {
    if (!status) return '';
    return `status-${status.split(' ')[0].toLowerCase()}`;
  };

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
        return <Submissions problemId={problemId} contestId={contestId} showTitle={false} />;
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