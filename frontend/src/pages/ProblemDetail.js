import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import styles from './ProblemDetail.module.css';
import CodeSubmissionForm from '../components/CodeSubmissionForm';
import Submissions from './Submissions';

const API_URL = process.env.REACT_APP_API_URL;

function ProblemDetail() {
  const { id } = useParams();
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeView, setActiveView] = useState('statement');

  const pdfEndpointUrl = `${API_URL}/api/problems/${id}/pdf`;

  useEffect(() => {
    const fetchProblem = async () => {
      try {
        const problemPromise = axios.get(`${API_URL}/api/problems/${id}`, { withCredentials: true });
        const statsPromise = axios.get(`${API_URL}/api/problems-with-stats`, { withCredentials: true });

        const [problemResponse, statsResponse] = await Promise.all([problemPromise, statsPromise]);
        
        const problemData = problemResponse.data;
        const allProblemsWithStats = statsResponse.data;
        const currentProblemStats = allProblemsWithStats.find(p => String(p.id) === id);

        setProblem({ ...problemData, ...currentProblemStats });
      } catch (err) {
        setError(`Failed to fetch problem ${id}.`);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProblem();
  }, [id]);

  const handlePdfView = () => {
    if (!problem || !problem.has_pdf) return;
    window.open(pdfEndpointUrl, '_blank');
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
  if (!problem) return <div className={styles['error-message']}>Problem not found.</div>;

  const renderContent = () => {
    switch (activeView) {
      case 'statement':
        return (
          <div className={styles['statement-view']}>
            {problem.has_pdf ? (
              <iframe src={pdfEndpointUrl} title={`${problem.title} PDF`} className={styles['pdf-preview']} />
            ) : (
              <div className={styles['no-pdf-message']}>No PDF available for preview.</div>
            )}
          </div>
        );
      case 'submit':
        return (
          <div className={styles['submit-view']}>
            <CodeSubmissionForm problemId={id} />
          </div>
        );
      case 'submissions':
        return <Submissions problemId={id} showTitle={false} />;
      default:
        return null;
    }
  };

  return (
    <div className={styles['problem-detail-container']}>
        <div className={styles['left-nav']}>
            <div className={styles['problem-info']}>
                <h2>{problem.title}</h2>
                <p className={styles['problem-id']}>{problem.id}</p>
                {problem.author && <p className={styles['problem-author']}>Author: {problem.author}</p>}
                
                <div className={styles['problem-meta']}>
                  <span>Time Limit: {problem.time_limit_ms} ms</span>
                  <span>Memory Limit: {problem.time_limit_mb} MB</span>
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
            <nav className={styles['problem-nav']}>
                <button 
                    className={`${styles['nav-btn']} ${activeView === 'statement' ? styles.active : ''}`}
                    onClick={() => setActiveView('statement')}
                >
                    Statement
                </button>
                <button 
                    className={`${styles['nav-btn']} ${activeView === 'submit' ? styles.active : ''}`}
                    onClick={() => setActiveView('submit')}
                >
                    Submit
                </button>
                <button 
                    className={`${styles['nav-btn']} ${activeView === 'submissions' ? styles.active : ''}`}
                    onClick={() => setActiveView('submissions')}
                >
                    Submissions
                </button>
            </nav>
            {problem && typeof problem.best_score !== 'undefined' && (
              <div className={styles['score-container']}>
                <div className={styles['score-bar-container']}>
                  <div
                    className={`${styles['score-bar']} ${
                      problem.best_score === 100 ? styles.full : problem.best_score > 0 ? styles.partial : styles.zero
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
              </div>
            )}
        </div>
        <div className={styles['right-content']}>
            {renderContent()}
        </div>
    </div>
  );
};

export default ProblemDetail; 