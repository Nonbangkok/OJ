import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { VerdictText } from '../../components/ui';
import submissionService from '../../services/submissionService';
import type { SubmissionSummary } from '../../types';
import { formatTimeAgo } from '../../utils/formatters';
import styles from './Home.parts.module.css';

const SHOWN = 5;
/** A compile log or a system message is one result entry, not a testcase. */
const NO_CASES = new Set(['Compilation Error', 'System Error', 'Pending', 'Compiling']);

/** Your latest verdicts, each opening its submission page. */
export default function RecentSubmissions() {
  const [rows, setRows] = useState<SubmissionSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    submissionService.getAll({ filter: 'mine' })
      .then((list) => { if (!cancelled) setRows(list.slice(0, SHOWN)); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className={styles.section} aria-labelledby="home-recent">
      <div className={styles.sectionHead}>
        <h2 id="home-recent" className={styles.sectionLabel}>Recent submissions</h2>
        <Link to="/submissions" className={styles.headLink}>All submissions</Link>
      </div>
      {rows === null ? null : rows.length === 0 ? (
        <p className={styles.empty}>No submissions yet — your verdicts will show up here.</p>
      ) : (
        <ul className={styles.rows}>
          {rows.map((s) => (
            <li key={s.id} className={styles.row}>
              <Link to={`/submissions/${s.id}`} className={styles.rowMain}>
                <span className={styles.rowTitle}>{s.problem_title ?? s.problem_id}</span>
                <span className={styles.mono}>{s.problem_id}</span>
              </Link>
              <VerdictText status={s.overall_status} results={NO_CASES.has(s.overall_status) ? [] : (s.case_statuses ?? []).map((status) => ({ status }))} />
              <span className={styles.rowWhen}>{formatTimeAgo(s.submitted_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
