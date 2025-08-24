import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import './ProblemDetail.css';
import CodeSubmissionForm from '../components/CodeSubmissionForm';
import ProblemSubmissionsList from './ProblemSubmissionsList';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

function ProblemDetail() {
  const { id } = useParams();
  const [problem, setProblem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submissionResult, setSubmissionResult] = useState(null);
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

  const handleSubmissionResult = (result) => {
    setSubmissionResult(result);
  };

  const getStatusClass = (status) => {
    if (!status) return '';
    return `status-${status.split(' ')[0].toLowerCase()}`;
  }

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error-message">{error}</div>;
  if (!problem) return <div className="error-message">Problem not found.</div>;

  const renderContent = () => {
    switch (activeView) {
      case 'statement':
        return (
          <div className="statement-view">
            <div className="problem-header">
              <h1>{problem.title}</h1>
              {problem.author && <p className="problem-author">Author : {problem.author}</p>}
              <div className="problem-meta">
                <span>Time Limit: {problem.time_limit_ms} ms</span>
                <span>Memory Limit: {problem.memory_limit_mb} MB</span>
              </div>
              {problem.has_pdf && (
                <button 
                  onClick={handlePdfView}
                  className="view-pdf-btn"
                >
                  View Problem PDF in New Tab
                </button>
              )}
            </div>
            {problem.has_pdf ? (
              <iframe src={pdfEndpointUrl} title={`${problem.title} PDF`} className="pdf-preview" />
            ) : (
              <div className="no-pdf-message">No PDF available for preview.</div>
            )}
          </div>
        );
      case 'submit':
        return (
          <div className="submit-view">
            <CodeSubmissionForm problemId={id} onSubmissionResult={handleSubmissionResult} />
            
            {submissionResult && (
              <div className="submission-result-container">
                <div className="submission-summary">
                  <div className="summary-item">
                    <span>Score</span>
                    <strong>{submissionResult.score}/100</strong>
                  </div>
                  <div className="summary-item">
                    <span>Status</span>
                    <strong className={getStatusClass(submissionResult.overallStatus)}>
                      {submissionResult.overallStatus}
                    </strong>
                  </div>
                  <div className="summary-item">
                    <span>Time</span>
                    <strong>{submissionResult.maxTimeMs} ms</strong>
                  </div>
                  <div className="summary-item">
                    <span>Memory</span>
                    <strong>{submissionResult.maxMemoryKb} KB</strong>
                  </div>
                </div>

                <h4>Test Cases:</h4>
                <table className="test-cases-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Status</th>
                      <th>Time (ms)</th>
                      <th>Memory (KB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submissionResult.results?.map(res => (
                      <tr key={res.testCase}>
                        <td>{res.testCase}</td>
                        <td className={getStatusClass(res.status)}>{res.status}</td>
                        <td>{res.timeMs >= 0 ? res.timeMs : '-'}</td>
                        <td>{res.memoryKb >= 0 ? res.memoryKb : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                
                {submissionResult.output && (
                  <div className="output-container">
                    <h4>Compiler/Runtime Output:</h4>
                    <pre>{submissionResult.output}</pre>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      case 'submissions':
        return <ProblemSubmissionsList problemId={id} />;
      default:
        return null;
    }
  };

  return (
    <div className="problem-detail-container">
        <div className="left-nav">
            <div className="problem-info">
                <h2>{problem.title}</h2>
                <p>{problem.id}</p>
            </div>
            <nav className="problem-nav">
                <button 
                    className={`nav-btn ${activeView === 'statement' ? 'active' : ''}`}
                    onClick={() => setActiveView('statement')}
                >
                    Statement
                </button>
                <button 
                    className={`nav-btn ${activeView === 'submit' ? 'active' : ''}`}
                    onClick={() => setActiveView('submit')}
                >
                    Submit
                </button>
                <button 
                    className={`nav-btn ${activeView === 'submissions' ? 'active' : ''}`}
                    onClick={() => setActiveView('submissions')}
                >
                    Submissions
                </button>
            </nav>
        </div>
        <div className="right-content">
            {renderContent()}
        </div>
    </div>
  );
};

export default ProblemDetail; 