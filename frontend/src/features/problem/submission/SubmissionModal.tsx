import Editor from 'react-simple-code-editor';
import useSubmissionModal from '../../../hooks/useSubmissionModal';
import { Dialog } from '../../../components/ui/Dialog';
import 'highlight.js/styles/atom-one-dark.css';

import styles from './SubmissionModal.module.css';
import editorStyles from '../../../components/styles/CodeEditor.module.css';
import tableStyles from '../../../components/styles/Table.module.css';
import { UI_CONFIG } from '../../../config/constants';
import { getLanguageDisplayName } from '../../../utils/constants';

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
      return <p className={styles['empty-message']}>No test results available.</p>;
    }

    if (parsedResults === 'error') {
      return <p className={styles['empty-message']}>Error parsing test results.</p>;
    }

    if (!Array.isArray(parsedResults) || parsedResults.length === 0) {
      return <p className={styles['empty-message']}>No test cases found.</p>;
    }

    return (
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
    );
  };

  return (
    <Dialog
      open={Boolean(submission)}
      onClose={onClose}
      title="Submission Detail"
      size="fullscreen"
    >
      <div className={styles['submission-detail']}>
        <div className={styles['detail-item']}>
          <span className={styles['detail-label']}>When</span>
          <span className={styles['detail-value']}>{formatDate(submission.submitted_at)}</span>
        </div>
        <div className={styles['detail-item']}>
          <span className={styles['detail-label']}>Problem</span>
          <span className={styles['detail-value']}>{submission.problem_name}</span>
        </div>
        <div className={styles['detail-item']}>
          <span className={styles['detail-label']}>User</span>
          <span className={styles['detail-value']}>{submission.username || 'Unknown'}</span>
        </div>
        <div className={styles['detail-item']}>
          <span className={styles['detail-label']}>Status</span>
          <span className={`${styles['detail-value']} ${getStatusClass(submission.overall_status)}`}>
            {submission.overall_status}
          </span>
        </div>
        <div className={styles['detail-item']}>
          <span className={styles['detail-label']}>Score</span>
          <span className={styles['detail-value']}>{submission.score}</span>
        </div>
        <div className={styles['detail-item']}>
          <span className={styles['detail-label']}>Language</span>
          <span className={styles['detail-value']}>{getLanguageDisplayName(submission.language)}</span>
        </div>
      </div>

      {/* Main Content: code left (~60%), testcase results right (~40%); each
          panel scrolls independently so neither overflows the modal. */}
      <div className={styles['main-content']}>
        <section className={`${styles['left-panel']} ${styles.panel}`} aria-label="Source code">
          <div className={styles['code-container']}>
            {/* Click-to-focus is a mouse convenience; Tab reaches the textarea directly. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
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
        </section>

        <section className={`${styles['right-panel']} ${styles.panel}`} aria-label="Testcase results">
          <div className={styles['testcase-container']}>
            {renderTestcaseResults()}
          </div>
        </section>
      </div>
    </Dialog>
  );
};

export default SubmissionModal;
