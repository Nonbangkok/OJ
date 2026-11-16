import { useEffect, useRef } from 'react';
import hljs from 'highlight.js/lib/core';
import cpp from 'highlight.js/lib/languages/cpp';
import xml from 'highlight.js/lib/languages/xml';
import Editor from 'react-simple-code-editor';
import styles from './Authoring.module.css';
import { readOnlyCodeEditorProps } from '../../../utils/readOnlyCodeEditor';

const ignoreEdit = () => {};

hljs.registerLanguage('cpp', cpp);
// Statements are HTML (with a little Markdown); highlight.js calls HTML "xml".
hljs.registerLanguage('xml', xml);

export type CodeLanguage = 'cpp' | 'html';
const HLJS_LANGUAGE: Record<CodeLanguage, string> = { cpp: 'cpp', html: 'xml' };

const escapeHtml = (code: string) => code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const highlighter = (language: CodeLanguage) => (code: string) => {
  try {
    return hljs.highlight(code, { language: HLJS_LANGUAGE[language] }).value;
  } catch {
    return escapeHtml(code);
  }
};
const HIGHLIGHT: Record<CodeLanguage, (code: string) => string> = { cpp: highlighter('cpp'), html: highlighter('html') };

/** Read/write source with line numbers and syntax highlighting, shared by
 *  the solution and generator editors (C++) and the statement editor (HTML). Same scroll model as the
 *  submission page's editor: the wrapper never scrolls — the internal
 *  textarea is the single scroller, with its position synced onto the
 *  gutter and the highlighted <pre>. */
export default function CodeEditor({ label, value, disabled, onChange, minLines = 14, language = 'cpp', fill = false }: {
  label: string; value: string; disabled: boolean;
  onChange: (value: string) => void; minLines?: number;
  language?: CodeLanguage;
  /** Fill the parent's height (the full-screen statement editor) instead of capping at 30rem. */
  fill?: boolean;
}) {
  const textareaId = `editor-${label.replace(/\W+/g, '-')}`;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = Math.max(value.split('\n').length, minLines);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const textarea = wrapper.querySelector('textarea');
    const pre = wrapper.querySelector('pre');
    if (!textarea || !pre) return;
    const syncScroll = () => {
      if (gutterRef.current) gutterRef.current.scrollTop = textarea.scrollTop;
      pre.scrollTop = textarea.scrollTop;
      pre.scrollLeft = textarea.scrollLeft;
    };
    textarea.addEventListener('scroll', syncScroll);
    return () => textarea.removeEventListener('scroll', syncScroll);
  }, []);

  return <div className={fill ? `${styles.codeEditor} ${styles.codeEditorFill}` : styles.codeEditor}>
    <label className={styles.codeLabel} htmlFor={textareaId}>{label}</label>
    <div className={styles.codeWrap} ref={wrapperRef}>
      <div className={styles.lineNumbers} ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => <div key={index + 1}>{index + 1}</div>)}
      </div>
      <div className={styles.codeScroll}>
        <Editor
          value={value}
          // While disabled (e.g. a job is running) the code stays scrollable
          // and selectable but cannot change: read-only, not disabled, which
          // Gecko browsers would make unscrollable.
          onValueChange={disabled ? ignoreEdit : onChange}
          highlight={HIGHLIGHT[language]}
          padding={14}
          {...(disabled ? readOnlyCodeEditorProps : {})}
          textareaId={textareaId}
          style={{
            fontFamily: 'var(--font-family-mono)',
            fontSize: 13,
            lineHeight: '1.55',
          }}
        />
      </div>
    </div>
  </div>;
}
