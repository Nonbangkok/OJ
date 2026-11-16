import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, InlineError, PageHeader, StatusBadge } from '../../../components/ui';
import buttonStyles from '../../../components/ui/Button.module.css';
import adminService from '../../../services/adminService';
import { getErrorMessage } from '../../../utils/error';
import type { Contest, ProblemBase } from '../../../types';
import ContestSettingsTab from './ContestSettingsTab';
import ContestProblemsTab from './ContestProblemsTab';
import ContestParticipantsTab from './ContestParticipantsTab';
import { bangkokParts, formatBangkokStart } from './bangkokTime';
import styles from './ContestEditor.module.css';

type ContestTab = 'settings' | 'problems' | 'participants';
const TABS: ContestTab[] = ['settings', 'problems', 'participants'];
const STATUS_TAG: Record<string, string> = { scheduled: 'SCHEDULED', running: 'RUNNING', finishing: 'JUDGING', finished: 'FINISHED' };

/** "27 Nov 2026, 19:00 – 21:00", or the full end when it falls on another Bangkok day. */
const windowLabel = (start: string, end: string) => {
  const s = bangkokParts(Date.parse(start));
  const e = bangkokParts(Date.parse(end));
  return `${formatBangkokStart(start)} – ${s.date === e.date ? e.time : formatBangkokStart(end)}`;
};

/** Full-page contest editor (§7.8) at /admin/contests/:contestId/:tab?. */
export default function ContestEditPage() {
  const { contestId = '' } = useParams();
  return <ContestEditor key={contestId} />;
}

function ContestEditor() {
  const { contestId = '', tab: tabParam } = useParams();
  const navigate = useNavigate();
  const id = Number(contestId);
  const base = `/admin/contests/${contestId}`;
  const [contest, setContest] = useState<Contest | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [problems, setProblems] = useState<ProblemBase[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // The admin list carries every fact the header needs (status, counts, visibility).
    adminService.getContests()
      .then((list) => {
        if (cancelled) return;
        const found = (list as Contest[]).find((c) => Number(c.id) === id) ?? null;
        setContest(found);
        setMissing(found === null);
      })
      .catch((err) => { if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load the contest.')); });
    adminService.getContestProblemsAdmin(id)
      .then((list) => { if (!cancelled) setProblems(list); })
      .catch(() => { if (!cancelled) setProblems([]); });
    return () => { cancelled = true; };
  }, [id]);

  const crumbs = [{ label: 'Manage' }, { label: 'Contests', to: '/admin/contests' }];
  if (missing || loadError) {
    return (
      <div className={styles.page}>
        <PageHeader breadcrumb={[...crumbs, { label: contestId }]} title="Contest" />
        {missing
          ? <EmptyState title="Contest not found" description="It may have been deleted." action={<Link to="/admin/contests">Back to contests</Link>} />
          : <InlineError message={loadError} />}
      </div>
    );
  }
  if (!contest) return <div className={styles.page}><p className={styles.muted} aria-live="polite">Loading contest…</p></div>;

  const tab: ContestTab = TABS.includes(tabParam as ContestTab) ? tabParam as ContestTab : 'settings';
  const participants = Number(contest.participant_count ?? 0);
  const problemCount = problems?.length ?? Number(contest.problem_count ?? 0);
  const labels: Record<ContestTab, { text: string; count?: number }> = {
    settings: { text: 'Settings' },
    problems: { text: 'Problems', count: problemCount },
    participants: { text: 'Participants', count: participants },
  };

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[...crumbs, { label: contest.title }]}
        title={<>{contest.title} <StatusBadge soft>{STATUS_TAG[contest.status] ?? contest.status.toUpperCase()}</StatusBadge></>}
        meta={`${windowLabel(contest.start_time, contest.end_time)} · ${participants} registered`}
        actions={(
          <Link to={`/contests/${contest.id}`} className={['oj-button', buttonStyles.button, buttonStyles.secondary, styles.linkButton].join(' ')}>
            Open contest page
          </Link>
        )}
        tabs={(
          <div className={styles.tabs} role="tablist" aria-label="Contest sections">
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? styles.tabActive : styles.tab}
                onClick={() => navigate(key === 'settings' ? base : `${base}/${key}`)}
              >
                {labels[key].text}
                {labels[key].count !== undefined && <span className={styles.count}> {labels[key].count}</span>}
              </button>
            ))}
          </div>
        )}
      />
      <div role="tabpanel" aria-label={labels[tab].text}>
        {tab === 'settings' && (
          <ContestSettingsTab contest={contest} onSaved={(next) => setContest((prev) => (prev ? { ...prev, ...next } : prev))} />
        )}
        {tab === 'problems' && (problems === null
          ? <p className={styles.muted} aria-live="polite">Loading problems…</p>
          : <ContestProblemsTab contestId={contest.id} status={contest.status} problems={problems} onProblemsChange={setProblems} />)}
        {tab === 'participants' && <ContestParticipantsTab contestId={contest.id} />}
      </div>
    </div>
  );
}
