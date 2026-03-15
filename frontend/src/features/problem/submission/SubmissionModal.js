import Editor from 'react-simple-code-editor';
import useSubmissionModal from '../../../hooks/useSubmissionModal';
import 'highlight.js/styles/atom-one-dark.css';

import styles from './SubmissionModal.module.css';
import editorStyles from '../../../components/styles/CodeEditor.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import { UI_CONFIG } from '../../../config/constants';

const SubmissionModal = ({ submission, onClose }) => {
  const {
    copySuccess,
    code,
    lineCount,
    hasScrollbar,
    lineNumbersRef,
    editorWrapperRef,
    handleWrapperClick,
    handleCopyCode,
    highlightCode,
    getStatusClass,
    formatDate,
    parsedResults,
  } = useSubmissionModal(submission);

  if (!submission) return null;

  const renderTestcaseResults = () => {
    if (!submission.results) {
      return <p style={{ padding: '1rem', textAlign: 'center' }}>No test results available.</p>;
    }

    if (parsedResults === 'error') {
      return <p style={{ padding: '1rem', textAlign: 'center' }}>Error parsing test results.</p>;
    }

    if (!Array.isArray(parsedResults) || parsedResults.length === 0) {
      return <p style={{ padding: '1rem', textAlign: 'center' }}>No test cases found.</p>;
    }

    return (
      <div className={tableStyles['table-container']}>
        <table className={tableStyles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Status</th>
              <th>Time(ms)</th>
              <th>Memory(KB)</th>
            </tr>
          </thead>
          <tbody>
            {parsedResults.map((result, index) => (
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
              <span className={styles['detail-label']}>Problem:</span>
              <span className={styles['detail-value']}>{submission.problem_name}</span>
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
                    onValueChange={() => { }}
                    highlight={highlightCode}
                    padding={16}
                    textareaId="code"
                    disabled={true}
                    style={{
                      fontFamily: '"Fira code", "Fira Mono", monospace',
                      fontSize: UI_CONFIG.DEFAULT_EDITOR_FONT_SIZE,
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
