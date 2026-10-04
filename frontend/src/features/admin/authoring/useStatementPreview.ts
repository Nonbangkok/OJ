import { useEffect, useRef, useState } from 'react';
import authoringService, { type StatementPreviewContext } from '../../../services/admin/authoringService';
import createStatementPreviewWorker from './statementPreviewWorkerFactory';
import type { PreviewAsset } from './statementPreviewRenderer';

export type StatementPreviewState = 'waiting' | 'loading' | 'ready' | 'error';
export interface StatementPreviewResult {
  html: string;
  state: StatementPreviewState;
  error: string;
}

export default function useStatementPreview(
  draftId: string | undefined,
  source: string | undefined,
  revision?: number
): StatementPreviewResult {
  const [context, setContext] = useState<StatementPreviewContext | null>(null);
  const [contextError, setContextError] = useState('');
  const [result, setResult] = useState<StatementPreviewResult>({ html: '', state: 'waiting', error: '' });
  const generation = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const renderTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setContext(null);
    setContextError('');
    setResult({ html: '', state: 'waiting', error: '' });
    if (!draftId) return () => { cancelled = true; };
    authoringService.getPreviewContext(draftId).then(value => {
      if (!cancelled) setContext(value);
    }).catch(() => {
      if (!cancelled) setContextError('Preview template could not be loaded. Your source is unchanged.');
    });
    return () => { cancelled = true; };
  }, [draftId]);

  // Asset metadata is small and changes only when a saved/uploaded asset does.
  // Refreshing it by revision keeps asset edits visible without fetching the
  // static document shell again.
  useEffect(() => {
    let cancelled = false;
    if (!draftId || revision === undefined) return () => { cancelled = true; };
    authoringService.listAssets(draftId).then(list => {
      if (!cancelled) setContext(current => current ? {
        ...current, assets: list.map(({ id, filename }) => ({ id, filename })),
      } : current);
    }).catch(() => { /* Keep the last known asset list while transiently offline. */ });
    return () => { cancelled = true; };
  }, [draftId, revision]);

  useEffect(() => {
    if (!draftId || !context) return;

    let active = true;
    let worker: Worker | undefined;
    try {
      const assets: PreviewAsset[] = context.assets.map(({ id, filename }) => ({
        filename, url: authoringService.draftAssetUrl(draftId, id),
      }));
      worker = createStatementPreviewWorker();
      workerRef.current = worker;
      worker.onmessage = event => {
        const message = event.data as { type: string; generation: number; html?: string; error?: string };
        if (!active || message.generation !== generation.current) return;
        if (renderTimeout.current) clearTimeout(renderTimeout.current);
        renderTimeout.current = null;
        if (message.type === 'rendered' && message.html) {
          setResult({ html: message.html, state: 'ready', error: '' });
        } else if (message.type === 'error') {
          setResult(current => ({ ...current, state: 'error', error: message.error || 'Statement preview failed.' }));
        }
      };
      worker.onerror = () => {
        if (!active) return;
        if (renderTimeout.current) clearTimeout(renderTimeout.current);
        renderTimeout.current = null;
        setResult(current => ({ ...current, state: 'error', error: 'Statement preview failed. Your source is unchanged.' }));
      };
      worker.postMessage({ type: 'initialize', shell: context.html, assets });
    } catch (error) {
      workerRef.current = null;
      setResult(current => ({ ...current, state: 'error', error: error instanceof Error ? error.message : 'Statement preview failed.' }));
    }
    return () => {
      active = false;
      if (renderTimeout.current) clearTimeout(renderTimeout.current);
      renderTimeout.current = null;
      worker?.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [context, draftId]);

  useEffect(() => {
    if (contextError) {
      setResult({ html: '', state: 'error', error: contextError });
      return;
    }
    if (!draftId || source === undefined || !context) {
      if (draftId && source !== undefined) setResult(current => ({ ...current, state: 'waiting' }));
      return;
    }

    const worker = workerRef.current;
    if (!worker) return;
    const currentGeneration = ++generation.current;
    setResult(current => ({ ...current, state: 'loading', error: '' }));
    try {
      worker.postMessage({ type: 'render', generation: currentGeneration, source });
      if (renderTimeout.current) clearTimeout(renderTimeout.current);
      renderTimeout.current = setTimeout(() => {
        if (generation.current === currentGeneration) {
          setResult(current => ({ ...current, state: 'error', error: 'Live preview did not finish. Your source is unchanged.' }));
        }
      }, 15000);
    } catch (error) {
      setResult(current => ({ ...current, state: 'error', error: error instanceof Error ? error.message : 'Statement preview failed.' }));
    }
  }, [context, contextError, draftId, source]);

  return result;
}
