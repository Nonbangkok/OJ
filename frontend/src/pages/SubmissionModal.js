import React from 'react';
import './SubmissionModal.css';

const SubmissionModal = ({ submission, onClose }) => {
  if (!submission) {
    return null;
  }

  const getStatusClass = (status) => {
    if (!status) return '';
    return `status-${status.split(' ')[0].toLowerCase()}`;
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Submission #{submission.id}</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        <div className="modal-body">
          <pre><code>{submission.code}</code></pre>
        </div>
        <div className="modal-footer">
          <h4>Test Cases:</h4>
          <table className="modal-test-cases-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Time (ms)</th>
                <th>Memory (KB)</th>
              </tr>
            </thead>
            <tbody>
              {submission.results?.map(res => (
                <tr key={res.testCase}>
                  <td>{res.testCase}</td>
                  <td className={getStatusClass(res.status)}>{res.status}</td>
                  <td>{res.timeMs >= 0 ? res.timeMs : '-'}</td>
                  <td>{res.memoryKb >= 0 ? res.memoryKb : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SubmissionModal; 