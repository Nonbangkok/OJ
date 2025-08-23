import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import './ProblemDetail.css';
import CodeSubmissionForm from '../components/CodeSubmissionForm';
import ProblemSubmissionsList from './ProblemSubmissionsList'; // Import the new component


const ProblemDetail = () => {
  const { id } = useParams();
  const [problem, setProblem] = useState(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openingPdf, setOpeningPdf] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [activeView, setActiveView] = useState('statement'); // 'statement', 'submit', or 'submissions'

  useEffect(() => {
    const fetchProblem = async () => {
      try {
        const response = await axios.get(`${process.env.REACT_APP_API_URL}/api/problems/${id}`, { withCredentials: true });
        setProblem(response.data);

        // After fetching problem, if pdf path exists, fetch the pdf blob
        if (response.data.problem_pdf_path) {
          try {
            const pdfResponse = await axios.get(`${process.env.REACT_APP_API_URL}${response.data.problem_pdf_path}`, {
              withCredentials: true,
              responseType: 'blob',
            });
            const file = new Blob([pdfResponse.data], { type: 'application/pdf' });
            const fileURL = URL.createObjectURL(file);
            setPdfUrl(fileURL);
          } catch (pdfErr) {
            console.error('Failed to fetch PDF:', pdfErr);
            setError('Problem data loaded, but the PDF could not be displayed.');
          }
        }
      } catch (err) {
        setError(`Failed to fetch problem ${id}.`);
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchProblem();
    
    // Cleanup object URL on component unmount
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [id]); // Rerun when id changes, pdfUrl is not needed here

  const handlePdfView = async () => {
    if (!problem || !problem.problem_pdf_path) return;
    setOpeningPdf(true);
    try {
      const response = await axios.get(`${process.env.REACT_APP_API_URL}${problem.problem_pdf_path}`, {
        withCredentials: true,
        responseType: 'blob',
      });
      
      const file = new Blob([response.data], { type: 'application/pdf' });
      const fileURL = URL.createObjectURL(file);
      window.open(fileURL, '_blank');

    } catch (err) {
      console.error('Failed to open PDF:', err);
      setError('Could not open the problem PDF. It may not exist or you may not have permission.');
    } finally {
      setOpeningPdf(false);
    }
  };

  const handleSubmissionResult = (result) => {
    setSubmissionResult(result);
  };

   // Helper to format status for CSS classes
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
              {problem.problem_pdf_path && (
                <button 
                  onClick={handlePdfView}
                  disabled={openingPdf}
                  className="view-pdf-btn"
                >
                  {openingPdf ? 'Opening...' : 'View Problem PDF in New Tab'}
                </button>
              )}
            </div>
            {pdfUrl ? (
              <iframe src={pdfUrl} title={`${problem.title} PDF`} className="pdf-preview" />
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