import { Link } from 'react-router-dom';
import { DifficultyBadge, Drawer, StatusBadge } from '../../../components/ui';
import { PROBLEM_DIFFICULTY_OPTIONS } from '../../../utils/constants';
import type { AdminProblem } from '../../../types';
import styles from './ProblemQuickLook.module.css';

/** "75% · 3 of 4" — practice submissions with a full score out of all submissions. */
export const acRateLabel = (problem: Pick<AdminProblem, 'submission_count' | 'accepted_count'>): string | null => {
  const total = problem.submission_count ?? 0;
  if (total === 0) return null;
  const accepted = problem.accepted_count ?? 0;
  return `${Math.round((accepted / total) * 100)}%`;
};

/**
 * Attached to a contest that has not finished yet (scheduled, running or
 * finishing): its visibility belongs to the contest and the server refuses
 * to change it. The Problems table and this quick look share the rule.
 */
export const isInContest = (problem: Pick<AdminProblem, 'contest_id'>): boolean => problem.contest_id != null;

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
};

interface ProblemQuickLookProps {
  problem: AdminProblem | null;
  /** What keeps students from being judged on it; empty when ready. */
  issues: string[];
  onClose: () => void;
  onSetDifficulty: (difficulty: number | null) => void;
  busy?: boolean;
}

/**
 * The row's quick look (§ admin problems group 2): the facts an admin checks
 * before deciding to edit, the links out, and a difficulty quick edit. The
 * full editor stays one click away.
 */
export default function ProblemQuickLook({ problem, issues, onClose, onSetDifficulty, busy = false }: ProblemQuickLookProps) {
  const inContest = problem !== null && isInContest(problem);
  const rate = problem ? acRateLabel(problem) : null;
  return (
    <Drawer open={problem !== null} title={problem?.title ?? ''} onClose={onClose}>
      {problem && (
        <div className={styles.body}>
          <p className={styles.sub}>
            <span className={styles.mono}>{problem.id}</span>
            {problem.problem_type === 'header' && <StatusBadge>HEADER</StatusBadge>}
            <DifficultyBadge difficulty={problem.difficulty} />
          </p>

          <dl className={styles.facts}>
            <dt>Health</dt>
            <dd className={issues.length > 0 ? styles.bad : undefined}>{issues.length > 0 ? issues.join(' · ') : 'Ready'}</dd>
            <dt>Visibility</dt>
            <dd>{inContest ? 'In contest' : problem.is_visible ? 'Visible' : 'Hidden'}</dd>
            <dt>Limits</dt>
            <dd className={styles.mono}>{problem.time_limit_ms ? `${problem.time_limit_ms} ms · ${problem.memory_limit_mb} MB` : '—'}</dd>
            <dt>Tests</dt>
            <dd>{`${problem.testcase_count ?? 0}${problem.testcase_bytes ? ` · ${formatBytes(problem.testcase_bytes)}` : ''}`}</dd>
            <dt>AC rate</dt>
            <dd>{rate ? `${rate} · ${problem.accepted_count ?? 0} of ${problem.submission_count ?? 0}` : 'No submissions yet'}</dd>
            <dt>Solvers</dt>
            <dd>{problem.solver_count ?? 0}</dd>
            <dt>Author</dt>
            <dd>{problem.author || '—'}</dd>
            <dt>Collection</dt>
            <dd>{problem.collection_name ?? '—'}</dd>
            <dt>Categories</dt>
            <dd className={styles.tags}>
              {(problem.categories ?? []).length > 0
                ? (problem.categories ?? []).map((c) => <span key={c} className={styles.tag}>{c}</span>)
                : '—'}
            </dd>
          </dl>

          <label className={styles.field}>
            <span>Difficulty</span>
            <select
              value={problem.difficulty ?? ''}
              disabled={busy}
              onChange={(e) => onSetDifficulty(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Unrated</option>
              {PROBLEM_DIFFICULTY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>

          <div className={styles.links}>
            <Link to={`/admin/problems/${encodeURIComponent(problem.id)}`} className={styles.primary}>Open editor</Link>
            <Link to={`/admin/problems/${encodeURIComponent(problem.id)}/testcases`}>Testcases</Link>
            <Link to={`/problems/${encodeURIComponent(problem.id)}`}>View as student</Link>
          </div>
        </div>
      )}
    </Drawer>
  );
}
