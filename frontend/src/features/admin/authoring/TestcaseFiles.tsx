import { Button, Dialog } from '../../../components/ui';
import { TestcaseMetadata } from './types';
import useTestcaseFiles from './useTestcaseFiles';
import TestcaseTable from './TestcaseTable';
import { formatDecimalSize } from './testcaseSize';
import { TestcasePreviewDialog, TestcaseReplaceDialog, TestcaseUploadForms } from './TestcaseDialogs';
import styles from './TestcaseFiles.module.css';

interface Props {
  draftId: string;
  revision: number;
  disabled: boolean;
  onMutated: () => Promise<void>;
  onError: (error: unknown) => void;
  onBusyChange?: (busy: boolean) => void;
  artifactVersion?: string;
  /** Phones: view and inspect only. */
  readOnly?: boolean;
}

export default function TestcaseFiles(props: Props) {
  return <TestcaseFilesContent key={props.draftId} {...props} />;
}

function TestcaseFilesContent({ draftId, revision, disabled, onMutated, onError, onBusyChange, artifactVersion, readOnly = false }: Props) {
  const model = useTestcaseFiles({ draftId, revision, disabled, onMutated, onError, onBusyChange, artifactVersion });
  const {
    testcases, loading, loaded, busy, inspecting, preview, errorMessage, savedRevision, locked,
  } = model;

  function replaceFromTable(testcase: TestcaseMetadata) {
    model.setEditing(testcase);
    model.setReplacementInput(null);
    model.setReplacementOutput(null);
    model.setReplacementVersion((value) => value + 1);
  }
  function requestReplaceAll() {
    model.setConfirmation({ kind: 'zip', revision });
  }
  function clearConfirmation() {
    if (!busy) model.setConfirmation(null);
  }

  return (
    <section className={styles.root} aria-label="Testcase files">
      <div className={styles.heading}>
        <h3>Testcase files</h3>
        {loaded && testcases.length > 0 && (
          <p className={styles.summary}>
            <span className={styles.mono}>{`${testcases.length} ${testcases.length === 1 ? 'testcase' : 'testcases'} · ${formatDecimalSize(testcases.reduce((sum, t) => sum + t.inputBytes + (t.outputBytes ?? 0), 0))}`}</span>
            {testcases.some((t) => !t.hasOutput) && <> · <span className={styles.missing}>{`${testcases.filter((t) => !t.hasOutput).length} missing output`}</span></>}
          </p>
        )}
        <button type="button" disabled={busy || loading} onClick={() => void model.retryRefresh()}>
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
        <p role="status">Changes saved. Refreshing…</p>
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
        <TestcaseTable
          testcases={testcases}
          busy={busy}
          inspecting={inspecting}
          locked={locked}
          readOnly={readOnly}
          onInspect={(testcase) => void model.inspect(testcase)}
          onReplace={replaceFromTable}
          onDelete={(testcase) => model.setConfirmation({ kind: 'delete', testcase, revision })}
        />
      )}

      {preview && <TestcasePreviewDialog preview={preview} onClose={() => model.setPreview(null)} />}

      {model.editing && (
        <TestcaseReplaceDialog
          testcase={model.editing}
          version={model.replacementVersion}
          locked={locked}
          input={model.replacementInput}
          output={model.replacementOutput}
          onSetInput={model.setReplacementInput}
          onSetOutput={model.setReplacementOutput}
          onSubmit={model.replaceTestcaseFiles}
          onClose={() => model.setEditing(null)}
        />
      )}

      {!readOnly && <TestcaseUploadForms
        formVersion={model.formVersion}
        locked={locked}
        input={model.input}
        output={model.output}
        archive={model.archive}
        onSetInput={model.setInput}
        onSetOutput={model.setOutput}
        onSetArchive={(file) => {
          model.setArchive(file);
          model.setConfirmation(null);
        }}
        onAppend={model.appendTestcase}
        onReplaceAll={requestReplaceAll}
      />}
      {model.confirmation && (
        <Dialog
          open
          title={model.confirmation.kind === 'zip' ? `Replace all ${testcases.length} ${testcases.length === 1 ? 'testcase' : 'testcases'}?` : 'Delete testcase?'}
          description={
            model.confirmation.kind === 'zip'
              ? `The archive ${model.archive?.name} will replace all ${testcases.length} existing testcases. This cannot be undone.`
              : `Delete ${model.confirmation.testcase.filename}? This cannot be undone.`
          }
          onClose={clearConfirmation}
          footer={
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => model.setConfirmation(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={locked}
                onClick={model.confirmMutation}
              >
                {model.confirmation.kind === 'zip' ? 'Confirm replacement' : 'Confirm deletion'}
              </Button>
            </>
          }
        />
      )}
    </section>
  );
}
