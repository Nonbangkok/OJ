import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './Authoring.module.css';

interface LivePreviewProps {
  shell: string;
  statement: string;
  zoomScale: number;
}

/** Keep the heavy document shell loaded while replacing only the statement body. */
export default function LivePreview({ shell, statement, zoomScale }: LivePreviewProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const statementRef = useRef(statement);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedDocumentRef = useRef<Document | null>(null);
  const [docHeight, setDocHeight] = useState(0);
  statementRef.current = statement;

  const measure = useCallback(() => {
    try {
      const frame = frameRef.current;
      const doc = frame?.contentDocument;
      if (!doc?.body) return;
      // Release the previous height before reading scrollHeight so a shorter
      // edit can shrink the frame instead of inheriting its old viewport size.
      if (frame) frame.style.height = 'auto';
      const height = Math.ceil(Math.max(
        doc.documentElement.scrollHeight,
        doc.documentElement.offsetHeight,
        doc.body.scrollHeight,
        doc.body.offsetHeight,
      ));
      if (frame) frame.style.height = `${height}px`;
      setDocHeight(current => current === height ? current : height);
    } catch { /* same-origin srcdoc; ignore transient access errors */ }
  }, []);

  const applyStatement = useCallback(() => {
    try {
      const article = frameRef.current?.contentDocument?.getElementById('statement');
      if (article && article.innerHTML !== statementRef.current) article.innerHTML = statementRef.current;
      measure();
    } catch { /* the iframe may still be navigating to a new shell */ }
  }, [measure]);

  const handleLoad = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    observerRef.current?.disconnect();
    if (observedDocumentRef.current) {
      observedDocumentRef.current.removeEventListener('load', measure, true);
      observedDocumentRef.current.fonts?.removeEventListener?.('loadingdone', measure);
    }
    observedDocumentRef.current = doc;
    doc.addEventListener('load', measure, true);
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(measure);
      observerRef.current.observe(doc.documentElement);
      observerRef.current.observe(doc.body);
    }
    doc.fonts?.addEventListener?.('loadingdone', measure);
    applyStatement();
    void doc.fonts?.ready.then(measure);
  }, [applyStatement, measure]);

  useEffect(() => {
    applyStatement();
  }, [applyStatement, shell, statement]);

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observedDocumentRef.current?.removeEventListener('load', measure, true);
    observedDocumentRef.current?.fonts?.removeEventListener?.('loadingdone', measure);
  }, [measure]);

  return <div className={styles.previewLive}
    style={{ width: `${100 / zoomScale}%`, height: docHeight ? `${Math.ceil(docHeight * zoomScale)}px` : undefined }}>
    <div className={styles.previewLiveZoom} style={{ transform: `scale(${zoomScale})` }}>
      <iframe title="Live statement preview" sandbox="allow-same-origin" srcDoc={shell}
        ref={frameRef} onLoad={handleLoad} className={styles.previewLiveFrame}
        style={docHeight ? { height: `${docHeight}px` } : undefined} />
    </div>
  </div>;
}
