import type { ReactNode } from 'react';
import { CheckCircle, Circle, Warning, XCircle } from '@phosphor-icons/react';
import { Button } from '../../../components/ui';
import authoringService from '../../../services/admin/authoringService';
import type { Draft, Job } from './types';
import type { ReadinessState } from './readiness';
import { formatDecimalSize } from './testcaseSize';
import styles from './Verify.module.css';

export type ReadinessRowKey = 'metadata' | 'statement' | 'solution' | 'testcases' | 'pdf' | 'verified';
export type ReadinessFix = { kind: 'tab'; to: 'metadata' | 'statement' | 'solution' | 'testcases' } | { kind: 'compile' | 'pdf' | 'verify' };

export interface ReadinessRow {
  key: ReadinessRowKey;
  state: ReadinessState;
  title: string;
  detail: ReactNode;
  fix?: { label: string; action: ReadinessFix };
  /** What to do before publishing, as a clause ("rebuild the PDF"); used for the Publish reason. */
  need?: string;
}

const STATE_LABEL: Record<ReadinessState, string> = { done: 'Done', todo: 'To do', stale: 'Out of date', failed: 'Failed' };
const GLYPH: Record<ReadinessState, ReactNode> = {
  done: <CheckCircle size={18} weight="fill" />,
  todo: <Circle size={18} />,
  stale: <Warning size={18} weight="fill" />,
  failed: <XCircle size={18} weight="fill" />,
};

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** The six rows of the Verify & publish tab (§7.9), from the draft, its jobs and the testcase byte total. */
export function readinessRows(draft: Draft, jobs: Job[], states: Record<'statement' | 'solution' | 'testcases' | 'pdf' | 'verified', ReadinessState>, testcaseBytes: number | null): ReadinessRow[] {
  const rev = draft.revision;
  const newest = (type: string) => jobs.filter((j) => j.jobType === type).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const metadataDone = Boolean(draft.problemId.trim() && draft.title.trim());
  const size = testcaseBytes === null ? '' : ` · ${formatDecimalSize(testcaseBytes)}`;
  const { total, withOutput } = draft.testcaseStats;

  const lastCompile = newest('compile_solution');
  const solutionDetail: Record<ReadinessState, string> = {
    done: `Compiled at rev ${rev}.`,
    todo: 'No solution yet.',
    stale: lastCompile ? `Last compiled at rev ${lastCompile.draftRevision} — the code changed since.` : 'Not compiled at this revision.',
    failed: 'The last compile failed.',
  };
  const pdfDetail: Record<ReadinessState, string> = {
    done: `The PDF is from rev ${draft.latestPdfRevision ?? rev}.`,
    todo: 'No PDF yet.',
    stale: `The PDF is from rev ${draft.latestPdfRevision ?? '—'}.`,
    failed: 'The last PDF build failed.',
  };
  const verify = newest('verify_all');
  const caseCount = verify?.status === 'succeeded' ? verify.resultSummary?.verification?.caseCount : undefined;
  const verifiedDetail: Record<ReadinessState, string> = {
    done: caseCount ? `All checks passed · ${plural(caseCount, 'testcase')} ran against the solution.` : 'All checks passed.',
    todo: 'Never verified.',
    stale: `Last verified at rev ${draft.verifiedRevision ?? '—'}.`,
    failed: `The last verify failed at rev ${rev}.`,
  };

  return [
    {
      key: 'metadata', state: metadataDone ? 'done' : 'todo', title: 'Metadata',
      detail: metadataDone ? `${draft.problemId} · ${draft.timeLimitMs} ms · ${draft.memoryLimitMb} MB` : 'A problem ID and a title are required.',
      fix: metadataDone ? undefined : { label: 'Open metadata', action: { kind: 'tab', to: 'metadata' } },
      need: 'fill in the metadata',
    },
    {
      key: 'statement', state: states.statement, title: 'Statement',
      detail: states.statement === 'done' ? 'Written.' : 'No statement yet.',
      fix: { label: 'Edit statement', action: { kind: 'tab', to: 'statement' } },
      need: 'write the statement',
    },
    {
      key: 'solution', state: states.solution, title: `Solution compiles at rev ${rev}`, detail: solutionDetail[states.solution],
      fix: states.solution === 'todo'
        ? { label: 'Open solution', action: { kind: 'tab', to: 'solution' } }
        : { label: 'Compile now', action: { kind: 'compile' } },
      need: states.solution === 'todo' ? 'write the solution' : 'compile the solution',
    },
    {
      key: 'testcases', state: states.testcases, title: 'Testcases',
      detail: total === 0 ? 'No testcases yet.'
        : withOutput === total ? `${plural(total, 'case')}, all with outputs${size}`
          : `${total - withOutput} of ${plural(total, 'case')} missing outputs${size}`,
      fix: { label: 'Open testcases', action: { kind: 'tab', to: 'testcases' } },
      need: total === 0 ? 'add testcases' : 'generate the missing outputs',
    },
    {
      key: 'pdf', state: states.pdf, title: 'PDF current', detail: pdfDetail[states.pdf],
      fix: { label: states.pdf === 'todo' ? 'Build PDF' : 'Rebuild PDF', action: { kind: 'pdf' } },
      need: states.pdf === 'todo' ? 'build the PDF' : 'rebuild the PDF',
    },
    {
      key: 'verified', state: states.verified, title: `Verified at rev ${rev}`, detail: verifiedDetail[states.verified],
      fix: { label: 'Run Verify', action: { kind: 'verify' } },
      need: `verify rev ${rev}`,
    },
  ];
}

/** "Rebuild the PDF and verify rev 14 before publishing." — from the rows that are not done. */
export function publishReason(rows: ReadinessRow[]): string | null {
  // The solution compiles as part of Verify, so a stale compile never blocks on its own.
  const needs = rows.filter((r) => r.state !== 'done' && r.need && !(r.key === 'solution' && r.state === 'stale')).map((r) => r.need as string);
  if (needs.length === 0) return null;
  const list = needs.length === 1 ? needs[0] : `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}`;
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} before publishing.`;
}

export default function ReadinessList({ draft, rows, disabled, onFix }: {
  draft: Draft; rows: ReadinessRow[]; disabled: boolean; onFix: (fix: ReadinessFix) => void;
}) {
  return (
    <ul className={styles.list} aria-label="Publish readiness">
      {rows.map((row) => {
        const fix = row.state === 'done' ? undefined : row.fix;
        return (
        <li key={row.key} className={styles.row} data-state={row.state}>
          <span className={styles.glyph} aria-hidden="true">{GLYPH[row.state]}</span>
          <span className={styles.body}>
            <span className={styles.title}>{row.title}</span>
            <span className={styles.srOnly}>{`, ${STATE_LABEL[row.state]}. `}</span>
            <span className={styles.detail}>{row.detail}</span>
          </span>
          <span className={styles.fix}>
            {row.key === 'pdf' && draft.hasLatestPdf && draft.latestPdfRevision !== null && (
              <a className={styles.link} href={authoringService.draftPdfUrl(draft.id, draft.latestPdfRevision)} target="_blank" rel="noreferrer">Open</a>
            )}
            {fix && (
              <Button size="compact" variant="secondary" disabled={disabled && fix.action.kind !== 'tab'} onClick={() => onFix(fix.action)}>
                {fix.label}
              </Button>
            )}
          </span>
        </li>
        );
      })}
    </ul>
  );
}
