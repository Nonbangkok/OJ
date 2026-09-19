import { useEffect, useRef } from 'react';
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
 *  shared by the solution and generator editors. Same scroll model as the
 *  submission page's editor: the wrapper never scrolls — the internal
 *  textarea is the single scroller, with its position synced onto the
 *  gutter and the highlighted <pre>. */
export default function CodeEditor({ label, value, disabled, onChange, minLines = 14 }: {
  label: string; value: string; disabled: boolean;
  onChange: (value: string) => void; minLines?: number;
}) {
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

  return <div className={styles.codeEditor}>
    <div className={styles.codeLabel}>{label}</div>
    <div className={styles.codeWrap} ref={wrapperRef}>
      <div className={styles.lineNumbers} ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, index) => <div key={index + 1}>{index + 1}</div>)}
      </div>
      <div className={styles.codeScroll}>
        <Editor
          value={value}
          onValueChange={onChange}
          highlight={highlight}
          padding={14}
          disabled={disabled}
          textareaId={`editor-${label.replace(/\W+/g, '-')}`}
          style={{
            fontFamily: '"Fira code", "Fira Mono", monospace',
            fontSize: 13,
            lineHeight: '1.55',
          }}
        />
      </div>
    </div>
  </div>;
}
