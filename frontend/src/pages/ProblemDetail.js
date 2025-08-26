import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import styles from './ProblemDetail.module.css';
import CodeSubmissionForm from '../components/CodeSubmissionForm';
import ProblemSubmissionsList from './ProblemSubmissionsList';

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
        const response = await axios.get(`${API_URL}/api/problems/${id}`, { withCredentials: true });
        setProblem(response.data);
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
        return <ProblemSubmissionsList problemId={id} />;
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
        </div>
        <div className={styles['right-content']}>
            {renderContent()}
        </div>
    </div>
  );
};

export default ProblemDetail; 