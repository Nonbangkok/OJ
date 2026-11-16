import { TestcaseMetadata } from './types';
import { formatDecimalSize } from './testcaseSize';
import styles from './TestcaseFiles.module.css';

export default function TestcaseTable({ testcases, busy, inspecting, locked, readOnly = false, onInspect, onReplace, onDelete }: {
  testcases: TestcaseMetadata[];
  busy: boolean;
  inspecting: boolean;
  locked: boolean;
  /** Phones: inspect only (§7.9 mobile policy). */
  readOnly?: boolean;
  onInspect: (testcase: TestcaseMetadata) => void;
  onReplace: (testcase: TestcaseMetadata) => void;
  onDelete: (testcase: TestcaseMetadata) => void;
}) {
  return <div className={styles.tableWrap}>
    <table>
      <caption>Testcases</caption>
      <thead>
        <tr>
          <th scope="col" className={styles.num}>#</th>
          <th scope="col">Input</th>
          <th scope="col" className={styles.num}>Input size</th>
          <th scope="col" className={styles.num}>Output size</th>
          <th scope="col">Source</th>
          <th scope="col"><span className={styles.srOnly}>Actions</span></th>
        </tr>
      </thead>
      <tbody>
        {testcases.map((testcase) => (
          <tr key={testcase.id}>
            <td className={`${styles.num} ${styles.mono}`}>{testcase.caseNumber}</td>
            <th scope="row" className={styles.mono}>{testcase.filename}</th>
            <td className={`${styles.num} ${styles.mono}`}>{formatDecimalSize(testcase.inputBytes)}</td>
            <td className={`${styles.num} ${styles.mono}`}>
              {testcase.hasOutput
                ? formatDecimalSize(testcase.outputBytes ?? 0)
                : <span className={styles.missing}>Missing output</span>}
            </td>
            <td className={styles.muted}>{testcase.source === 'generated' ? `generated · rev ${testcase.sourceRevision}` : testcase.source}</td>
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
                {!readOnly && <button
                  type="button"
                  disabled={locked}
                  aria-label={`Replace files for ${testcase.filename}`}
                  onClick={() => onReplace(testcase)}
                >
                  Replace files
                </button>}
                {!readOnly && <button
                  type="button"
                  disabled={locked}
                  aria-label={`Delete ${testcase.filename}`}
                  onClick={() => onDelete(testcase)}
                >
                  Delete
                </button>}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>;
}
