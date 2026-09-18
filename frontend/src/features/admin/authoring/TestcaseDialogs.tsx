import { Button, Dialog } from '../../../components/ui';
import { TestcaseMetadata } from './types';
import { Preview } from './useTestcaseFiles';
import styles from './TestcaseFiles.module.css';

export function TestcasePreviewDialog({ preview, onClose }: { preview: Preview; onClose: () => void }) {
  return <Dialog
    open
    title={`Preview: ${preview.filename}`}
    onClose={onClose}
    footer={
      <Button variant="secondary" onClick={onClose}>
        Close preview
      </Button>
    }
  >
    <div className={styles.previewColumns}>
      <div className={styles.previewColumn}>
        <h5>Input</h5>
        <pre aria-label="Input preview">{preview.input.text || '(Empty input)'}</pre>
        {preview.input.truncated && <p className={styles.previewTruncated}>Truncated at 32 KiB</p>}
      </div>
      <div className={styles.previewColumn}>
        <h5>Output</h5>
        {preview.output === null ? (
          <p className={styles.previewMissing}>Missing output</p>
        ) : (
          <>
            <pre aria-label="Output preview">{preview.output.text || '(Empty output)'}</pre>
            {preview.output.truncated && <p className={styles.previewTruncated}>Truncated at 32 KiB</p>}
          </>
        )}
      </div>
    </div>
  </Dialog>;
}

export function TestcaseReplaceDialog({ testcase, version, locked, input, output, onSetInput, onSetOutput, onSubmit, onClose }: {
  testcase: TestcaseMetadata;
  version: number;
  locked: boolean;
  input: File | null;
  output: File | null;
  onSetInput: (file: File | null) => void;
  onSetOutput: (file: File | null) => void;
  onSubmit: () => void;
  onClose: () => void;
}) {
  return (
    <form
      key={`edit-${testcase.id}-${version}`}
      id="replace-testcase-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (input || output) onSubmit();
      }}
    >
      <Dialog
        open
        title={`Replace files: ${testcase.filename}`}
        description="Replacing input clears the existing output unless you also supply a replacement output. An output alone keeps the input."
        onClose={onClose}
        footer={
          <>
            <Button
              form="replace-testcase-form"
              type="submit"
              disabled={locked || (!input && !output)}
            >
              Save replacement files
            </Button>
            <Button variant="secondary" onClick={onClose}>
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
              onChange={(event) => onSetInput(event.target.files?.[0] ?? null)}
            />
          </label>
          <label>
            Replacement output (optional)
            <input
              type="file"
              onChange={(event) => onSetOutput(event.target.files?.[0] ?? null)}
            />
          </label>
        </fieldset>
      </Dialog>
    </form>
  );
}

export function TestcaseUploadForms({ formVersion, locked, input, output, archive, onSetInput, onSetOutput, onSetArchive, onAppend, onReplaceAll }: {
  formVersion: number;
  locked: boolean;
  input: File | null;
  output: File | null;
  archive: File | null;
  onSetInput: (file: File | null) => void;
  onSetOutput: (file: File | null) => void;
  onSetArchive: (file: File | null) => void;
  onAppend: () => void;
  onReplaceAll: () => void;
}) {
  return <div className={styles.uploadBar}>
    <form
      key={`append-${formVersion}`}
      className={styles.uploadForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (input) onAppend();
      }}
    >
      <fieldset disabled={locked}>
        <label>
          Input file
          <input
            type="file"
            required
            onChange={(event) => onSetInput(event.target.files?.[0] ?? null)}
          />
        </label>
        <label>
          Output file (optional)
          <input type="file" onChange={(event) => onSetOutput(event.target.files?.[0] ?? null)} />
        </label>
        <button type="submit" disabled={!input}>
          Append testcase
        </button>
      </fieldset>
    </form>
    <form
      key={`zip-${formVersion}`}
      className={styles.uploadForm}
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked && archive) onReplaceAll();
      }}
    >
      <fieldset disabled={locked}>
        <label>
          ZIP archive (replaces all)
          <input
            type="file"
            accept=".zip,application/zip"
            required
            onChange={(event) => onSetArchive(event.target.files?.[0] ?? null)}
          />
        </label>
        <button type="submit" disabled={!archive}>
          Replace all from ZIP
        </button>
      </fieldset>
    </form>
  </div>;
}
