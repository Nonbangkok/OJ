import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../../components/ui';
import { UI_TIMEOUTS } from '../../../config/constants';
import { AI_DOC_TITLE, aiDocsSections, buildAiDocsMarkdown, DocBlock } from './aiDocsContent';
import styles from './AiDocs.module.css';

/**
 * Inline text renderer: turns `code` spans and **bold** into elements. The
 * copyable markdown stays a plain string (aiDocsContent); this is only the
 * human view of it.
 */
function InlineText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'heading':
      return block.level === 3 ? <h3>{block.text}</h3> : <h4>{block.text}</h4>;
    case 'paragraph':
      return <p><InlineText text={block.text} /></p>;
    case 'list':
      return block.ordered ? (
        <ol className={styles.docList}>
          {block.items.map((item, i) => <li key={i} className={styles.docListItem}><InlineText text={item} /></li>)}
        </ol>
      ) : (
        <ul className={styles.docList}>
          {block.items.map((item, i) => <li key={i} className={styles.docListItem}><InlineText text={item} /></li>)}
        </ul>
      );
    case 'code':
      return (
        <pre className={styles.codeBlock}>
          <code>{block.code}</code>
        </pre>
      );
    case 'table':
      return (
        /* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- A named
           scrollable region needs keyboard focus so keyboard users can scroll
           wide tables; same pattern as the shared OverflowTable. */
        <div className={styles.tableWrap} role="region" aria-label="Reference table" tabIndex={0}>
          <table>
            <thead>
              <tr>{block.head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{j === 0 ? <code>{cell}</code> : <InlineText text={cell} />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/**
 * The AI Docs tab: the authoring API as an in-app reference document. The
 * content lives in aiDocsContent (single source); this component renders it
 * with the app's visual system and offers the markdown version for copying.
 *
 * Rendered two ways: standalone at /admin/authoring/ai-docs (with a back
 * link, like the Author profiles page) and embedded as the last section of
 * a draft workspace (no back link — the workspace left nav is present).
 */
export default function AiDocs({ embedded = false }: { embedded?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    const markdown = buildAiDocsMarkdown();
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(markdown);
      } else {
        // Fallback for non-secure contexts or older browsers.
        const textArea = document.createElement('textarea');
        textArea.value = markdown;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) throw new Error('Fallback copy failed');
      }
      setCopyFailed(false);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), UI_TIMEOUTS.COPY_CLIPBOARD);
    } catch {
      setCopied(false);
      setCopyFailed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopyFailed(false), UI_TIMEOUTS.SUCCESS_MESSAGE_LONG);
    }
  };

  return (
    <section className={styles.docs} aria-label={AI_DOC_TITLE}>
      {!embedded && <Link to="/admin/authoring" className={styles.backLink}>← All drafts</Link>}
      <div className={styles.header}>
        <div className={styles.headerText}>
          <h1>AI Docs</h1>
          <p>
            The authoring API as one reference document — for humans here, and for AI agents
            via the copy button: the entire page is copied as clean, prompt-ready markdown.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant={copied ? 'secondary' : 'primary'}
            onClick={handleCopy}
            aria-live="polite"
          >
            {copied ? 'Copied!' : 'Copy for AI agent'}
          </Button>
        </div>
      </div>
      {copyFailed && (
        <p role="alert" className={styles.copyError}>
          Could not access the clipboard. Copy is unavailable in this context.
        </p>
      )}
      <nav className={styles.toc} aria-label="Document sections">
        <ol>
          {aiDocsSections.map(section => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.title}</a>
            </li>
          ))}
        </ol>
      </nav>
      <article className={styles.body}>
        {aiDocsSections.map(section => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`}>
            <h2 id={`${section.id}-heading`}>{section.title}</h2>
            {section.blocks.map((block, i) => <Block key={i} block={block} />)}
          </section>
        ))}
      </article>
    </section>
  );
}
