import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import formStyles from './Form.module.css'; // Use the new shared form styles
import styles from './CodeSubmissionForm.module.css'; // Keep for specific adjustments

const API_URL = process.env.REACT_APP_API_URL;

const CodeSubmissionForm = ({ problemId }) => {
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      // The backend now responds immediately with a submission ID
      await axios.post(`${API_URL}/submit`, {
        problemId,
        language,
        code,
      }, {
        withCredentials: true
      });

      // On success, navigate to the submissions page
      navigate('/submissions');

    } catch (err) {
      const errorMsg = err.response?.data?.message || 'An unexpected error occurred.';
      setError(errorMsg);
      console.error('Error submitting code:', err);
      setIsSubmitting(false); // Re-enable the form on error
    }
    // No finally block to reset isSubmitting, because we are navigating away
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
    <div className={styles['submission-form-container']}>
      <h3>Submit Solution</h3>
      {error && <p className="error-message" style={{ color: 'red', marginBottom: '1rem' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div className={formStyles['form-group']}>
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
        <div className={formStyles['form-group']}>
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