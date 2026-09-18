import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import 'highlight.js/styles/atom-one-dark.css';
import Editor from 'react-simple-code-editor';
import styles from './Authoring.module.css';

hljs.registerLanguage('cpp', cpp);

const highlight = (code: string) => {
  try {
    return hljs.highlight(code, { language: 'cpp' }).value;
  } catch {
    return code;
  }
};

/** Read/write C++ source with line numbers and syntax highlighting,
 *  shared by the solution and generator editors. */
export default function CodeEditor({ label, value, disabled, onChange, minLines = 14 }: {
  label: string; value: string; disabled: boolean;
  onChange: (value: string) => void; minLines?: number;
}) {
  const lineCount = Math.max(value.split('\n').length, minLines);
  return <div className={styles.codeEditor}>
    <div className={styles.codeLabel}>{label}</div>
    <div className={styles.codeWrap}>
      <div className={styles.lineNumbers} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => <div key={index + 1}>{index + 1}</div>)}
      </div>
      <Editor
        value={value}
        onValueChange={onChange}
        highlight={highlight}
        padding={14}
        disabled={disabled}
        textareaId={`editor-${label.replace(/\W+/g, '-')}`}
        className={styles.codeInput}
        style={{
          fontFamily: '"Fira code", "Fira Mono", monospace',
          fontSize: 13,
          lineHeight: '1.55',
          minHeight: `${lineCount * 1.55 * 13 + 28}px`,
        }}
      />
    </div>
  </div>;
}
