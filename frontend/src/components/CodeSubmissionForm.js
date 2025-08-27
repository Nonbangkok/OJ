import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import Editor from 'react-simple-code-editor';

// Import highlight.js
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import './CodeEditor.css';
import formStyles from './Form.module.css';
import styles from './CodeSubmissionForm.module.css';

// Register C++ language after all imports
hljs.registerLanguage('cpp', cpp);

const API_URL = process.env.REACT_APP_API_URL;

const CodeSubmissionForm = ({ problemId }) => {
  const [language, setLanguage] = useState('cpp');
  const [code, setCode] = useState(`#include <iostream>\n\nint main() {\n    // Your code here\n    return 0;\n}`);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const editorWrapperRef = useRef(null);
  const lineNumbersRef = useRef(null);

  // Sync scrolling between the editor's textarea, the <pre> block, and the line numbers gutter
  useEffect(() => {
    const editorEl = editorWrapperRef.current;
    if (!editorEl) return;

    const textarea = editorEl.querySelector('textarea');
    const pre = editorEl.querySelector('pre'); // Find the <pre> block for highlighted code

    if (!textarea || !pre) return;

    const syncScroll = () => {
      const scrollTop = textarea.scrollTop;
      const scrollLeft = textarea.scrollLeft;

      if (lineNumbersRef.current) {
        lineNumbersRef.current.scrollTop = scrollTop;
      }
      
      // Sync the <pre> block's scroll position to match the textarea
      pre.scrollTop = scrollTop;
      pre.scrollLeft = scrollLeft;
    };

    textarea.addEventListener('scroll', syncScroll);

    return () => {
      textarea.removeEventListener('scroll', syncScroll);
    };
  }, []); // Run only once to attach the listener

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      await axios.post(`${API_URL}/submit`, {
        problemId,
        language,
        code,
      }, {
        withCredentials: true
      });
      navigate('/submissions');
    } catch (err) {
      const errorMsg = err.response?.data?.message || 'An unexpected error occurred.';
      setError(errorMsg);
      console.error('Error submitting code:', err);
      setIsSubmitting(false);
    }
  };

  const highlightCode = (code) => {
    try {
      return hljs.highlight(code, { language: 'cpp' }).value;
    } catch (e) {
      console.warn('Highlighting error:', e);
      return code;
    }
  };

  const lineCount = code.split('\n').length;

  const handleWrapperClick = () => {
    editorWrapperRef.current?.querySelector('textarea')?.focus();
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
          <div className="editor-wrapper" ref={editorWrapperRef} onClick={handleWrapperClick}>
            <div className="line-numbers-gutter" ref={lineNumbersRef}>
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i + 1}>{i + 1}</div>
              ))}
            </div>
            <div className="editor-container">
              <Editor
                value={code}
                onValueChange={code => setCode(code)}
                highlight={highlightCode}
                padding={16}
                textareaId="code"
                disabled={isSubmitting}
                style={{
                  fontFamily: '"Fira code", "Fira Mono", monospace',
                  fontSize: 16,
                  lineHeight: 1.5, // Ensure line height matches CSS
                }}
              />
            </div>
          </div>
        </div>
        <button type="submit" disabled={isSubmitting} className={formStyles['submit-button']}>
          {isSubmitting ? 'Submitting...' : 'Submit'}
        </button>
      </form>
    </div>
  );
};

export default CodeSubmissionForm; 