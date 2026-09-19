import { TestcaseMetadata } from './types';
import { formatByteSize } from './testcaseSize';
import styles from './TestcaseFiles.module.css';

export default function TestcaseTable({ testcases, busy, inspecting, locked, onInspect, onReplace, onDelete }: {
  testcases: TestcaseMetadata[];
  busy: boolean;
  inspecting: boolean;
  locked: boolean;
  onInspect: (testcase: TestcaseMetadata) => void;
  onReplace: (testcase: TestcaseMetadata) => void;
  onDelete: (testcase: TestcaseMetadata) => void;
}) {
  return <div className={styles.tableWrap}>
    <table>
      <caption>Testcase metadata</caption>
      <thead>
        <tr>
          <th scope="col">Case</th>
          <th scope="col">Input filename</th>
          <th scope="col">Input</th>
          <th scope="col">Output</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {testcases.map((testcase) => (
          <tr key={testcase.id}>
            <td>{testcase.caseNumber}</td>
            <th scope="row">{testcase.filename}</th>
            <td>{formatByteSize(testcase.inputBytes)}</td>
            <td>
              {testcase.hasOutput
                ? formatByteSize(testcase.outputBytes ?? 0)
                : 'Missing output'}
            </td>
            <td>
              <div className={styles.actions}>
                <button
                  type="button"
                  disabled={busy || inspecting}
                  aria-label={`Inspect ${testcase.filename}`}
                  onClick={() => onInspect(testcase)}
                >
                  Inspect
                </button>
                <button
                  type="button"
                  disabled={locked}
                  aria-label={`Replace files for ${testcase.filename}`}
                  onClick={() => onReplace(testcase)}
                >
                  Replace files
                </button>
                <button
                  type="button"
                  disabled={locked}
                  aria-label={`Delete ${testcase.filename}`}
                  onClick={() => onDelete(testcase)}
                >
                  Delete
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}
