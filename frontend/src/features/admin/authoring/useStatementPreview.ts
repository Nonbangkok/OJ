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
    if (contextError) {
      setResult({ html: '', state: 'error', error: contextError });
      return;
    }
    if (!draftId || source === undefined || !context) {
      if (draftId && source !== undefined) setResult(current => ({ ...current, state: 'waiting' }));
      return;
    }

    const currentGeneration = ++generation.current;
    let active = true;
    let worker: Worker | undefined;
    setResult(current => ({ ...current, state: 'loading', error: '' }));
    try {
      const assets: PreviewAsset[] = context.assets.map(({ id, filename }) => ({
        filename, url: authoringService.draftAssetUrl(draftId, id),
      }));
      worker = createStatementPreviewWorker();
      worker.onmessage = event => {
        const message = event.data as { type: string; generation: number; html?: string; error?: string };
        if (!active || message.generation !== currentGeneration) return;
        if (message.type === 'rendered' && message.html) {
          setResult({ html: message.html, state: 'ready', error: '' });
        } else if (message.type === 'error') {
          setResult(current => ({ ...current, state: 'error', error: message.error || 'Statement preview failed.' }));
        }
      };
      worker.onerror = () => {
        if (active) setResult(current => ({ ...current, state: 'error', error: 'Statement preview failed. Your source is unchanged.' }));
      };
      worker.postMessage({ type: 'initialize', shell: context.html, assets });
      worker.postMessage({ type: 'render', generation: currentGeneration, source });
    } catch (error) {
      setResult(current => ({ ...current, state: 'error', error: error instanceof Error ? error.message : 'Statement preview failed.' }));
    }
    return () => { active = false; worker?.terminate(); };
  }, [context, contextError, draftId, source]);

  return result;
}
