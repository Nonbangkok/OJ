import { useId } from 'react';
import { StatusDot } from '../../../components/ui';
import type { Job } from './types';
import styles from './Code.module.css';

const DOT: Record<string, ['pass' | 'fail' | 'warn' | 'neutral', string]> = {
  succeeded: ['pass', 'OK'], failed: ['fail', 'Failed'], timed_out: ['fail', 'Timed out'],
  queued: ['neutral', 'Queued'], compiling: ['warn', 'Compiling'], running: ['warn', 'Running'],
};

/** The newest compile of one target and whether it matches the current revision (§7.9 result panel). */
export default function LastCompile({ jobs, jobType, revision }: { jobs: Job[]; jobType: string; revision: number }) {
  const headingId = useId();
  const job = jobs
    .filter((j) => j.jobType === jobType)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const [tone, label]: ['pass' | 'fail' | 'warn' | 'neutral', string] = job ? DOT[job.status] ?? ['neutral', job.status] : ['neutral', 'Not compiled yet'];
  const warnings = job?.resultSummary?.warnings ?? [];
  const duration = job?.resultSummary?.durationMs;
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <div className={styles.panelHead}>
        <b id={headingId}>Last compile</b>
        <StatusDot tone={tone} label={label} />
      </div>
      {job && (
        <dl className={styles.facts}>
          <div><dt>Revision</dt><dd className={styles.mono}>{job.draftRevision}</dd></div>
          {duration !== undefined && <div><dt>Time</dt><dd className={styles.mono}>{`${(duration / 1000).toFixed(1)} s`}</dd></div>}
          <div><dt>Warnings</dt><dd className={styles.mono}>{warnings.length}</dd></div>
        </dl>
      )}
      {job?.errorMessage && <p className={styles.error}>{job.errorMessage}</p>}
      {warnings.length > 0 && <pre className={styles.log}>{warnings.join('\n')}</pre>}
      {job && job.draftRevision < revision && (
        <p className={styles.note}>{`Compiled at rev ${job.draftRevision} — the code changed since, so this result is stale until you compile again.`}</p>
      )}
    </section>
  );
}
