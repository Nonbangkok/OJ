import type { KeyboardEvent } from 'react';
import Editor from 'react-simple-code-editor';
import useCodeSubmission from '../../../hooks/useCodeSubmission';
import { Button, FileDrop, InlineError } from '../../../components/ui';
import editorStyles from '../../../components/styles/CodeEditor.module.css';
import styles from './CodeSubmissionForm.module.css';
import { UI_CONFIG } from '../../../config/constants';
import { SUPPORTED_LANGUAGES, getLanguageDisplayName } from '../../../utils/constants';

/** Largest file the drop zone loads into the editor. */
const MAX_SOURCE_BYTES = 256 * 1024;

interface CodeSubmissionFormProps {
  problemId: string;
  contestId?: string | null;
  submissionFilename?: string | null;
  /** The new submission's id; the page shows its live result. */
  onSubmitted?: (submissionId: number) => void;
}

const CodeSubmissionForm = ({ problemId, contestId = null, submissionFilename = null, onSubmitted }: CodeSubmissionFormProps) => {
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
    handleWrapperClick,
    loadFile,
  } = useCodeSubmission(problemId, contestId, submissionFilename, onSubmitted);

  // ⌘Enter / Ctrl+Enter submits from inside the editor.
  const onEditorKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void handleSubmit();
    }
  };

  const accept = submissionFilename ? ['.h', '.hpp'] : ['.cpp', '.cc', '.py'];

  return (
    <div className={styles['submission-form-container']}>
      <div className={styles.formHeader}>
        {submissionFilename ? (
          <span className={styles.languageLabel}>{getLanguageDisplayName('cpp')}</span>
        ) : (
          <div className={styles.languageButtons} role="group" aria-label="Language">
            {SUPPORTED_LANGUAGES.map((supportedLanguage) => (
              <button
                key={supportedLanguage}
                type="button"
                className={language === supportedLanguage ? styles.active : ''}
                aria-pressed={language === supportedLanguage}
                onClick={() => setLanguage(supportedLanguage)}
                disabled={isSubmitting}
              >
                {getLanguageDisplayName(supportedLanguage)}
              </button>
            ))}
          </div>
        )}
      </div>
      {submissionFilename && (
        <p className={styles.headerHelp}>
          Submit only {submissionFilename} {'—'} it is compiled with the grader&apos;s own main.cpp.
        </p>
      )}
      <FileDrop
        label="Load a file into the editor"
        hint={`${accept.join(', ')} · up to 256 KB`}
        accept={accept}
        maxBytes={MAX_SOURCE_BYTES}
        disabled={isSubmitting}
        onFiles={(files) => { if (files[0]) void loadFile(files[0]); }}
      />
      {error && <InlineError message={error} />}
      <form onSubmit={handleSubmit} className={styles.form}>
        <label htmlFor="code" className={styles.editorLabel}>
          {submissionFilename ? `Your ${submissionFilename}` : 'Your code'}
        </label>
        {/* Click-to-focus is a mouse convenience; Tab reaches the textarea directly. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
        <div className={editorStyles['editorWrapper']} ref={editorWrapperRef} onClick={handleWrapperClick} onKeyDown={onEditorKeyDown}>
          <div className={editorStyles['lineNumbersGutter']} ref={lineNumbersRef}>
            {Array.from({ length: lineCount }).map((_, i) => (
              <div key={i + 1}>{i + 1}</div>
            ))}
          </div>
          <div className={editorStyles['editorContainer']}>
            <Editor
              value={code}
              onValueChange={(next) => setCode(next)}
              highlight={highlightCode}
              padding={16}
              textareaId="code"
              disabled={isSubmitting}
              style={{
                fontFamily: 'var(--font-family-mono)',
                fontSize: UI_CONFIG.DEFAULT_EDITOR_FONT_SIZE,
                lineHeight: 1.5,
              }}
            />
          </div>
        </div>
        <div className={styles.submitRow}>
          <Button type="submit" variant="primary" disabled={isSubmitting} loading={isSubmitting} loadingLabel="Submitting…">
            Submit <kbd className={styles.kbd} aria-hidden="true">⌘↵</kbd>
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CodeSubmissionForm;
