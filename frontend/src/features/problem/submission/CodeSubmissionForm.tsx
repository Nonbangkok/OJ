import Editor from 'react-simple-code-editor';

import useCodeSubmission from '../../../hooks/useCodeSubmission';

import editorStyles from '../../../components/styles/CodeEditor.module.css';
import formStyles from '../../../components/styles/Form.module.css';
import styles from './CodeSubmissionForm.module.css';
import { UI_CONFIG } from '../../../config/constants';

const CodeSubmissionForm = ({ problemId, contestId }) => {
  const {
    language,
    setLanguage,
    code,
    setCode,
    isSubmitting,
    error,
    editorWrapperRef,
    lineNumbersRef,
    handleSubmit,
    highlightCode,
    lineCount,
    handleWrapperClick
  } = useCodeSubmission(problemId, contestId);

  return (
    <div className={styles['submission-form-container']}>
      <div className={styles.formHeader}>
        <h2>Submit Solution</h2>
        <div className={styles.languageButtons}>
          <button
            className={language === 'cpp' ? styles.active : ''}
            onClick={() => setLanguage('cpp')}
            disabled={isSubmitting}
          >
            C++
          </button>
        </div>
      </div>

      {error && <p className="error-message" style={{ color: 'red', marginBottom: '1rem' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        <div className={formStyles['form-group']}>
          <label htmlFor="code">Your Code:</label>
          <div className={editorStyles['editorWrapper']} ref={editorWrapperRef} onClick={handleWrapperClick}>
            <div className={editorStyles['lineNumbersGutter']} ref={lineNumbersRef}>
              {Array.from({ length: lineCount }).map((_, i) => (
                <div key={i + 1}>{i + 1}</div>
              ))}
            </div>
            <div className={editorStyles['editorContainer']}>
              <Editor
                value={code}
                onValueChange={code => setCode(code)}
                highlight={highlightCode}
                padding={16}
                textareaId="code"
                disabled={isSubmitting}
                style={{
                  fontFamily: '"Fira code", "Fira Mono", monospace',
                  fontSize: UI_CONFIG.DEFAULT_EDITOR_FONT_SIZE,
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