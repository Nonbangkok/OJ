import React, { useState } from 'react';
import axios from 'axios';
import './Form.css'; // Use the new shared form styles
import './CodeSubmissionForm.css'; // Keep for specific adjustments

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';

const CodeSubmissionForm = ({ problemId, onSubmissionResult }) => {
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Provide a structured initial state for the parent to render
    onSubmissionResult({ 
      overallStatus: 'Judging...', 
      score: '–', 
      maxTimeMs: '–', 
      maxMemoryKb: '–',
      results: [] 
    });

    try {
      const response = await axios.post(`${API_URL}/submit`, {
        problemId,
        language,
        code,
      }, {
        withCredentials: true
      });

      // The backend now returns the full, structured result. Pass it directly.
      onSubmissionResult(response.data);

    } catch (error) {
      const errorData = error.response?.data || {};
      // On error, create a result object that still fits the display structure
      onSubmissionResult({
        overallStatus: 'Submission Error',
        score: 0,
        results: [{ testCase: 1, status: errorData.message || 'An unexpected error occurred.' }],
        output: errorData.output,
        maxTimeMs: 0,
        maxMemoryKb: 0,
      });
      console.error('Error submitting code:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleTabKey = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const { target } = e;
      const { selectionStart, selectionEnd } = target;
      const val = target.value;
      
      // Insert 2 spaces for a tab
      target.value = val.substring(0, selectionStart) + '  ' + val.substring(selectionEnd);
      
      // Move cursor
      target.selectionStart = target.selectionEnd = selectionStart + 2;
      
      // Trigger onChange
      setCode(target.value);
    }
  };

  return (
    <div className="submission-form-container">
      <h3>Submit Solution</h3>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="language">Language:</label>
          <select
            id="language"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isSubmitting}
          >
            <option value="cpp">C++</option>
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="code">Your Code:</label>
          <textarea
            id="code"
            rows="15"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={handleTabKey}
            disabled={isSubmitting}
            placeholder="Enter your C++ code here..."
          ></textarea>
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </button>
      </form>
    </div>
  );
};

export default CodeSubmissionForm; 