import { useCallback, useEffect, useRef, useState } from 'react';
import authoringService from '../../../services/admin/authoringService';
import { TestcaseMetadata } from './types';
import { previewText } from './testcasePreview';

export interface Preview {
  filename: string;
  input: ReturnType<typeof previewText>;
  output: ReturnType<typeof previewText> | null;
}
export type Confirmation =
  | { kind: 'zip'; revision: number }
  | { kind: 'delete'; testcase: TestcaseMetadata; revision: number };

interface Options {
  draftId: string;
  revision: number;
  disabled: boolean;
  onMutated: () => Promise<void>;
  onError: (error: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
  artifactVersion?: string;
}

/** Owns the testcase list, every mutation, and the busy/lock state for the
 *  testcase files section. Both refreshes (parent draft + local list) run after
 *  every mutation; a failed refresh surfaces as an error while selected files
 *  and the previous view are kept for a retry. */
export default function useTestcaseFiles({ draftId, revision, disabled, onMutated, onError, onBusyChange, artifactVersion }: Options) {
  const [testcases, setTestcases] = useState<TestcaseMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [savedRevision, setSavedRevision] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(true);
  const listRequest = useRef(0);
  const inspectionRequest = useRef(0);
  const errorHandler = useRef(onError);
  errorHandler.current = onError;
  const locked = disabled || busy || loading || !loaded || savedRevision > revision;

  const reportError = useCallback((error: unknown) => {
    if (!mounted.current) return;
    setErrorMessage(
      'Unable to complete the request. Your selected files and previous view have been kept.'
    );
    errorHandler.current(error);
  }, []);

  const refreshList = useCallback(async () => {
    const request = ++listRequest.current;
    setLoading(true);
    try {
      const response = await authoringService.listTestcases(draftId);
      if (mounted.current && request === listRequest.current) {
        setTestcases(response.testcases);
        setLoaded(true);
      }
    } finally {
      if (mounted.current && request === listRequest.current) setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setPreview(null);
    inspectionRequest.current++;
    setInspecting(false);
    setConfirmation(null);
    void refreshList().catch(reportError);
  }, [revision, artifactVersion, refreshList, reportError]);

  const inspect = useCallback(async (testcase: TestcaseMetadata) => {
    if (inspecting || busy) return;
    const request = ++inspectionRequest.current;
    setInspecting(true);
    setErrorMessage('');
    try {
      const data = await authoringService.getTestcase(draftId, testcase.id);
      if (mounted.current && request === inspectionRequest.current) {
        setPreview({
          filename: data.filename,
          input: previewText(data.input),
          output: data.output === null ? null : previewText(data.output),
        });
      }
    } catch (error) {
      if (request === inspectionRequest.current) reportError(error);
    } finally {
      if (mounted.current && request === inspectionRequest.current) setInspecting(false);
    }
  }, [busy, draftId, inspecting, reportError]);

  function multipart(files: { input?: File | null; output?: File | null; archive?: File | null }) {
    const body = new FormData();
    body.append('expectedRevision', String(revision));
    for (const [name, file] of Object.entries(files)) if (file) body.append(name, file);
    return body;
  }

  const mutate = useCallback(async (request: () => Promise<{ revision: number }>) => {
    if (locked || pending.current) return;
    pending.current = true;
    onBusyChange?.(true);
    inspectionRequest.current++;
    setInspecting(false);
    setBusy(true);
    setErrorMessage('');
    try {
      const result = await request();
      if (mounted.current) setSavedRevision(result.revision);
      // Both refreshes are required, including when the parent's refresh fails.
      let refreshError: unknown;
      try {
        await onMutated();
      } catch (error) {
        refreshError = error;
      }
      try {
        if (mounted.current) await refreshList();
      } catch (error) {
        refreshError = error;
      }
      if (refreshError) throw refreshError;
      if (!mounted.current) return;
      resetFiles();
    } catch (error) {
      reportError(error);
    } finally {
      pending.current = false;
      onBusyChange?.(false);
      if (mounted.current) setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, onBusyChange, onMutated, refreshList, reportError]);

  const retryRefresh = useCallback(async () => {
    if (pending.current || busy || loading) return;
    pending.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setErrorMessage('');
    try {
      if (savedRevision > revision) await onMutated();
      await refreshList();
    } catch (error) {
      reportError(error);
    } finally {
      pending.current = false;
      onBusyChange?.(false);
      if (mounted.current) setBusy(false);
    }
  }, [busy, loading, onBusyChange, onMutated, refreshList, reportError, revision, savedRevision]);

  // File selections and dialogs, reset after every successful mutation.
  const [input, setInput] = useState<File | null>(null);
  const [output, setOutput] = useState<File | null>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const [editing, setEditing] = useState<TestcaseMetadata | null>(null);
  const [replacementInput, setReplacementInput] = useState<File | null>(null);
  const [replacementOutput, setReplacementOutput] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [replacementVersion, setReplacementVersion] = useState(0);

  function resetFiles() {
    setInput(null);
    setOutput(null);
    setArchive(null);
    setReplacementInput(null);
    setReplacementOutput(null);
    setEditing(null);
    setConfirmation(null);
    setPreview(null);
    setFormVersion((value) => value + 1);
  }

  const appendTestcase = useCallback(() => {
    if (!input) return;
    void mutate(() => authoringService.appendTestcase(draftId, multipart({ input, output })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, input, mutate, output, revision]);

  const replaceTestcaseFiles = useCallback(() => {
    if (!editing || (!replacementInput && !replacementOutput)) return;
    const caseId = editing.id;
    void mutate(() =>
      authoringService.replaceTestcase(draftId, caseId, multipart({ input: replacementInput, output: replacementOutput }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, editing, mutate, replacementInput, replacementOutput, revision]);

  const confirmMutation = useCallback(() => {
    if (!confirmation || confirmation.revision !== revision || locked) return;
    if (confirmation.kind === 'zip' && archive) {
      void mutate(() => authoringService.appendTestcase(draftId, multipart({ archive })));
    } else if (confirmation.kind === 'delete') {
      const id = confirmation.testcase.id;
      void mutate(() => authoringService.deleteTestcase(draftId, id, revision));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archive, confirmation, draftId, locked, mutate, revision]);

  return {
    testcases, loading, loaded, busy, inspecting, preview, setPreview, errorMessage, savedRevision, locked,
    input, setInput, output, setOutput, archive, setArchive,
    editing, setEditing, replacementInput, setReplacementInput, replacementOutput, setReplacementOutput,
    confirmation, setConfirmation, formVersion, replacementVersion, setReplacementVersion,
    inspect, mutate, retryRefresh, appendTestcase, replaceTestcaseFiles, confirmMutation,
  };
}
