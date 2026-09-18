import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog } from '../../../components/ui';
import api from '../../../services/api';
import styles from './TestcaseFiles.module.css';

interface Props {
  draftId: string;
  revision: number;
  disabled: boolean;
  onMutated: () => Promise<void>;
  onError: (error: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
  artifactVersion?: string;
}

interface TestcaseMetadata {
  id: string;
  caseNumber: number;
  filename: string;
  inputBytes: number;
  outputBytes: number | null;
  hasOutput: boolean;
  source: string;
  sourceRevision: number;
  createdAt: string;
  updatedAt: string;
}
interface PreviewText {
  text: string;
  truncated: boolean;
}
interface Preview {
  filename: string;
  input: PreviewText;
  output: PreviewText | null;
}
type Confirmation =
  | { kind: 'zip'; revision: number }
  | { kind: 'delete'; testcase: TestcaseMetadata; revision: number };

// Bound retained and rendered text by UTF-8 bytes without encoding the entire response.
function previewText(value: string): PreviewText {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    if (bytes + size > 32 * 1024) break;
    bytes += size;
    end += character.length;
  }
  return { text: value.slice(0, end), truncated: end < value.length };
}

export default function TestcaseFiles(props: Props) {
  return <TestcaseFilesContent key={props.draftId} {...props} />;
}

function TestcaseFilesContent({ draftId, revision, disabled, onMutated, onError, onBusyChange, artifactVersion }: Props) {
  const base = `/admin/authoring/drafts/${encodeURIComponent(draftId)}/testcases`;
  const [testcases, setTestcases] = useState<TestcaseMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [savedRevision, setSavedRevision] = useState(0);
  const [input, setInput] = useState<File | null>(null);
  const [output, setOutput] = useState<File | null>(null);
  const [archive, setArchive] = useState<File | null>(null);
  const [editing, setEditing] = useState<TestcaseMetadata | null>(null);
  const [replacementInput, setReplacementInput] = useState<File | null>(null);
  const [replacementOutput, setReplacementOutput] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [formVersion, setFormVersion] = useState(0);
  const [replacementVersion, setReplacementVersion] = useState(0);
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
      const response = await api.get<{ revision: number; testcases: TestcaseMetadata[] }>(base);
      if (mounted.current && request === listRequest.current) {
        setTestcases(response.data.testcases);
        setLoaded(true);
      }
    } finally {
      if (mounted.current && request === listRequest.current) setLoading(false);
    }
  }, [base]);

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

  async function inspect(testcase: TestcaseMetadata) {
    if (inspecting || busy) return;
    const request = ++inspectionRequest.current;
    setInspecting(true);
    setErrorMessage('');
    try {
      const { data } = await api.get<TestcaseMetadata & { input: string; output: string | null }>(
        `${base}/${encodeURIComponent(testcase.id)}`
      );
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
  }

  function multipart(files: { input?: File | null; output?: File | null; archive?: File | null }) {
    const body = new FormData();
    body.append('expectedRevision', String(revision));
    for (const [name, file] of Object.entries(files)) if (file) body.append(name, file);
    return body;
  }

  async function mutate(request: () => Promise<{ data: { revision: number } }>) {
    if (locked || pending.current) return;
    pending.current = true;
    onBusyChange?.(true);
    inspectionRequest.current++;
    setInspecting(false);
    setBusy(true);
    setErrorMessage('');
    try {
      const { data } = await request();
      if (mounted.current) setSavedRevision(data.revision);
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
      setInput(null);
      setOutput(null);
      setArchive(null);
      setReplacementInput(null);
      setReplacementOutput(null);
      setEditing(null);
      setConfirmation(null);
      setPreview(null);
      setFormVersion((value) => value + 1);
    } catch (error) {
      reportError(error);
    } finally {
      pending.current = false;
      onBusyChange?.(false);
      if (mounted.current) setBusy(false);
    }
  }

  async function retryRefresh() {
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
  }

  function confirmMutation() {
    if (!confirmation || confirmation.revision !== revision || locked) return;
    if (confirmation.kind === 'zip' && archive) {
      void mutate(() => api.post(base, multipart({ archive })));
    } else if (confirmation.kind === 'delete') {
      const id = confirmation.testcase.id;
      void mutate(() =>
        api.delete(`${base}/${encodeURIComponent(id)}`, { data: { expectedRevision: revision } })
      );
    }
  }

  return (
    <section className={styles.root} aria-label="Testcase files">
      <div className={styles.heading}>
        <h3>Testcase files</h3>
        <button type="button" disabled={busy || loading} onClick={() => void retryRefresh()}>
          Refresh testcases
        </button>
      </div>
      <p>
        Append individual files, replace an existing case, or replace the entire set with a ZIP
        archive. An empty output file is valid; an omitted output is missing.
      </p>
      {disabled && (
        <p>
          File changes are unavailable while this draft is read-only, has unsaved changes, or has an
          active job.
        </p>
      )}
      {savedRevision > revision && (
        <p role="status">Changes saved. Waiting for the draft revision to refresh.</p>
      )}
      {errorMessage && <p role="alert">{errorMessage}</p>}
      {(loading || busy || inspecting) && (
        <p role="status">
          {busy
            ? 'Saving testcase changes…'
            : inspecting
              ? 'Loading testcase preview…'
              : 'Loading testcases…'}
        </p>
      )}
      {loaded && testcases.length === 0 && <p>No testcases yet.</p>}
      {testcases.length > 0 && (
        <div className={styles.tableWrap}>
          <table>
            <caption>Testcase metadata</caption>
            <thead>
              <tr>
                <th scope="col">Case</th>
                <th scope="col">Input filename</th>
                <th scope="col">Input</th>
                <th scope="col">Output</th>
                <th scope="col">Source</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {testcases.map((testcase) => (
                <tr key={testcase.id}>
                  <td>{testcase.caseNumber}</td>
                  <th scope="row">{testcase.filename}</th>
                  <td>{testcase.inputBytes.toLocaleString()} bytes</td>
                  <td>
                    {testcase.hasOutput
                      ? `${(testcase.outputBytes ?? 0).toLocaleString()} bytes`
                      : 'Missing output'}
                  </td>
                  <td>
                    {testcase.source} · revision {testcase.sourceRevision}
                  </td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        disabled={busy || inspecting}
                        aria-label={`Inspect ${testcase.filename}`}
                        onClick={() => void inspect(testcase)}
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        aria-label={`Replace files for ${testcase.filename}`}
                        onClick={() => {
                          setEditing(testcase);
                          setReplacementInput(null);
                          setReplacementOutput(null);
                          setReplacementVersion((value) => value + 1);
                        }}
                      >
                        Replace files
                      </button>
                      <button
                        type="button"
                        disabled={locked}
                        aria-label={`Delete ${testcase.filename}`}
                        onClick={() => setConfirmation({ kind: 'delete', testcase, revision })}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className={styles.hint}>
        Previews show up to 32 KiB per file. Opening a preview downloads the complete testcase.
      </p>
      {preview && (
        <Dialog
          open
          title={`Preview: ${preview.filename}`}
          onClose={() => setPreview(null)}
          footer={
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Close preview
            </Button>
          }
        >
          <h5>Input</h5>
          <pre aria-label="Input preview">{preview.input.text || '(Empty input)'}</pre>
          {preview.input.truncated && <p>Input preview truncated at 32 KiB.</p>}
          <h5>Output</h5>
          {preview.output === null ? (
            <p>Missing output</p>
          ) : (
            <>
              <pre aria-label="Output preview">{preview.output.text || '(Empty output)'}</pre>
              {preview.output.truncated && <p>Output preview truncated at 32 KiB.</p>}
            </>
          )}
        </Dialog>
      )}

      {editing && (
        <form
          key={`edit-${editing.id}-${replacementVersion}`}
          id="replace-testcase-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (replacementInput || replacementOutput)
              void mutate(() =>
                api.patch(
                  `${base}/${encodeURIComponent(editing.id)}`,
                  multipart({ input: replacementInput, output: replacementOutput })
                )
              );
          }}
        >
          <Dialog
            open
            title={`Replace files: ${editing.filename}`}
            description="Replacing input clears the existing output unless you also supply a replacement output. An output alone keeps the input."
            onClose={() => setEditing(null)}
            footer={
              <>
                <Button
                  form="replace-testcase-form"
                  type="submit"
                  disabled={locked || (!replacementInput && !replacementOutput)}
                >
                  Save replacement files
                </Button>
                <Button variant="secondary" onClick={() => setEditing(null)}>
                  Cancel replacement
                </Button>
              </>
            }
          >
            <fieldset disabled={locked} className={styles.dialogFields}>
              <label>
                Replacement input (optional)
                <input
                  type="file"
                  onChange={(event) => setReplacementInput(event.target.files?.[0] ?? null)}
                />
              </label>
              <label>
                Replacement output (optional)
                <input
                  type="file"
                  onChange={(event) => setReplacementOutput(event.target.files?.[0] ?? null)}
                />
              </label>
            </fieldset>
          </Dialog>
        </form>
      )}

      <div className={styles.forms}>
        <form
          key={`append-${formVersion}`}
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            if (input) void mutate(() => api.post(base, multipart({ input, output })));
          }}
        >
          <fieldset disabled={locked}>
            <legend>Append a testcase</legend>
            <label>
              New testcase input
              <input
                type="file"
                required
                onChange={(event) => setInput(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              New testcase output (optional)
              <input type="file" onChange={(event) => setOutput(event.target.files?.[0] ?? null)} />
            </label>
            <button type="submit" disabled={!input}>
              Append testcase
            </button>
          </fieldset>
        </form>
        <form
          key={`zip-${formVersion}`}
          className={styles.panel}
          onSubmit={(event) => {
            event.preventDefault();
            if (!locked && archive) setConfirmation({ kind: 'zip', revision });
          }}
        >
          <fieldset disabled={locked}>
            <legend>Replace all testcases from ZIP</legend>
            <p>
              This removes every existing testcase and replaces the set with the archive contents.
            </p>
            <label>
              Testcase ZIP archive
              <input
                type="file"
                accept=".zip,application/zip"
                required
                onChange={(event) => {
                  setArchive(event.target.files?.[0] ?? null);
                  setConfirmation(null);
                }}
              />
            </label>
            <button type="submit" disabled={!archive}>
              Replace all from ZIP
            </button>
          </fieldset>
        </form>
      </div>
      {confirmation && (
        <Dialog
          open
          title={confirmation.kind === 'zip' ? 'Replace every testcase?' : 'Delete testcase?'}
          description={
            confirmation.kind === 'zip'
              ? `The archive ${archive?.name} will replace all ${testcases.length} existing testcases. This cannot be undone.`
              : `Delete ${confirmation.testcase.filename}? This cannot be undone.`
          }
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={locked}
                onClick={confirmMutation}
              >
                {confirmation.kind === 'zip' ? 'Confirm replacement' : 'Confirm deletion'}
              </Button>
            </>
          }
        />
      )}
    </section>
  );
}
