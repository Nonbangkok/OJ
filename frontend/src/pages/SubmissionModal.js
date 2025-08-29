import React, { useState, useRef, useEffect } from 'react';
import Editor from 'react-simple-code-editor';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';

// Import highlight.js theme CSS
import 'highlight.js/styles/atom-one-dark.css';

import styles from './SubmissionModal.module.css';
import editorStyles from '../components/CodeEditor.module.css';
import '../components/Table.css';

// Register C++ language
hljs.registerLanguage('cpp', cpp);

const SubmissionModal = ({ submission, onClose }) => {
  const [copySuccess, setCopySuccess] = useState(false);
  const [code, setCode] = useState('');
  const [lineCount, setLineCount] = useState(1);
  const [hasScrollbar, setHasScrollbar] = useState(false);
  const lineNumbersRef = useRef(null);
  const editorWrapperRef = useRef(null);

  useEffect(() => {
    if (submission?.code) {
      setCode(submission.code);
      setLineCount(submission.code.split('\n').length);
    }
  }, [submission]);
  
  // Sync scrolling between line numbers and code
  useEffect(() => {
    if (!submission) return;

    const editorEl = editorWrapperRef.current;
    if (!editorEl) return;
    
    const textarea = editorEl.querySelector('textarea');
    const lineNumbers = lineNumbersRef.current;
    
    if (!textarea || !lineNumbers) return;

    // Check for scrollbar presence
    const checkScrollbar = () => {
      const isScrollbarVisible = textarea.scrollHeight > textarea.clientHeight;
      setHasScrollbar(isScrollbarVisible);
    };

    // Check initially and on any resize of the textarea
    const resizeObserver = new ResizeObserver(checkScrollbar);
    resizeObserver.observe(textarea);
    
    // Initial check after a short delay to allow DOM to render
    const timeoutId = setTimeout(checkScrollbar, 50);

    const syncScroll = () => {
      lineNumbers.scrollTop = textarea.scrollTop;
      const pre = editorEl.querySelector('pre');
      if (pre) {
          pre.scrollTop = textarea.scrollTop;
          pre.scrollLeft = textarea.scrollLeft;
      }
    };

    textarea.addEventListener('scroll', syncScroll);
    
    return () => {
      clearTimeout(timeoutId);
      resizeObserver.disconnect();
      textarea.removeEventListener('scroll', syncScroll);
    };
  }, [submission, code]);

  if (!submission) return null;

  const handleWrapperClick = () => {
    editorWrapperRef.current?.querySelector('textarea')?.focus();
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
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

  const getStatusClass = (status) => {
    if (!status) return '';
    return `status-${status.split(' ')[0].toLowerCase()}`;
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString();
  };

  const renderTestcaseResults = () => {
    if (!submission.results) {
      return <p style={{ padding: '1rem', textAlign: 'center' }}>No test results available.</p>;
    }

    let results;
    try {
      results = typeof submission.results === 'string'
        ? JSON.parse(submission.results)
        : submission.results;
    } catch (e) {
      return <p style={{ padding: '1rem', textAlign: 'center' }}>Error parsing test results.</p>;
    }

    if (!Array.isArray(results) || results.length === 0) {
      return <p style={{ padding: '1rem', textAlign: 'center' }}>No test cases found.</p>;
    }

    return (
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Time(ms)</th>
              <th>Memory(KB)</th>
            </tr>
          </thead>
          <tbody>
            {results.map((result, index) => (
              <tr key={index}>
                <td>{result.testCase || index + 1}</td>
                <td className={getStatusClass(result.status)}>{result.status}</td>
                <td>{result.timeMs !== undefined ? result.timeMs : '-'}</td>
                <td>{result.memoryKb !== undefined ? result.memoryKb : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className={styles['modal-overlay']} onClick={onClose}>
      <div className={styles['modal-content']} onClick={(e) => e.stopPropagation()}>
        {/* Top Bar */}
        <div className={styles['top-bar']}>
          {/* Submission Detail */}
          <div className={styles['submission-detail']}>
            <div className={styles['detail-row']}>
              <span className={styles['detail-label']}>When:</span>
              <span className={styles['detail-value']}>{formatDate(submission.submitted_at)}</span>
            </div>
            <div className={styles['detail-row']}>
              <span className={styles['detail-label']}>User:</span>
              <span className={styles['detail-value']}>{submission.username || 'Unknown'}</span>
            </div>
            <div className={styles['detail-row']}>
              <span className={styles['detail-label']}>Status:</span>
              <span className={`${styles['detail-value']} ${getStatusClass(submission.overall_status)}`}>
                {submission.overall_status}
              </span>
            </div>
            <div className={styles['detail-row']}>
              <span className={styles['detail-label']}>Score:</span>
              <span className={styles['detail-value']}>{submission.score}</span>
            </div>
            <div className={styles['detail-row']}>
              <span className={styles['detail-label']}>Language:</span>
              <span className={styles['detail-value']}>{submission.language}</span>
            </div>
          </div>

          {/* Close Button */}
          <button className={styles['close-button']} onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Main Content */}
        <div className={styles['main-content']}>
          {/* Left Side - Code Editor */}
          <div className={styles['left-panel']}>
            <div className={styles['code-container']}>
              <div className={editorStyles['editorWrapper']} ref={editorWrapperRef} onClick={handleWrapperClick}>
                <button
                  className={styles['copy-button']}
                  onClick={handleCopyCode}
                  title={copySuccess ? 'Copied!' : 'Copy code'}
                  style={{ right: hasScrollbar ? '1.5rem' : '0.5rem' }}
                >
                  {copySuccess ? '✓' : '📋'}
                </button>
                <div className={editorStyles['lineNumbersGutter']} ref={lineNumbersRef}>
                  {Array.from({ length: lineCount }).map((_, i) => (
                    <div key={i + 1}>{i + 1}</div>
                  ))}
                </div>
                <div className={editorStyles['editorContainer']}>
                  <Editor
                    value={code}
                    onValueChange={() => {}}
                    highlight={highlightCode}
                    padding={16}
                    textareaId="code"
                    disabled={true}
                    style={{
                      fontFamily: '"Fira code", "Fira Mono", monospace',
                      fontSize: 16,
                      lineHeight: 1.5, // Ensure line height matches CSS
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Right Side - Testcase Results */}
          <div className={styles['right-panel']}>
            <div className={styles['testcase-container']}>
              {renderTestcaseResults()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SubmissionModal;
