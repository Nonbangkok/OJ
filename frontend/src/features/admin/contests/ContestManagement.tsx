import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button, ConfirmDialog, DataTable, FilterBar, InlineError, PageHeader, SegmentedControl, StatusDot,
  type ActionMenuItem, type DataTableColumn,
} from '../../../components/ui';
import adminService from '../../../services/adminService';
import useRejudge from '../../../hooks/admin/useRejudge';
import { useAuth } from '../../../context/AuthContext';
import { useCountdown } from '../../../components/shell/useCountdown';
import { getErrorMessage } from '../../../utils/error';
import RejudgeFeedbackBox from '../shared/RejudgeFeedbackBox';
import CreateContestDrawer from './CreateContestDrawer';
import { BANGKOK_NOTE, formatBangkokStart, formatDuration } from './bangkokTime';
import type { Contest } from '../../../types';
import styles from './Contests.module.css';

type StatusFilter = 'all' | 'scheduled' | 'running' | 'finished';
const SEGMENTS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'scheduled', label: 'Scheduled' }, { value: 'running', label: 'Running' }, { value: 'finished', label: 'Finished' },
];
// "finishing" (ended, last judges draining) files under Finished.
const bucketOf = (status: string): StatusFilter => (status === 'running' ? 'running' : status === 'scheduled' ? 'scheduled' : 'finished');

function RunningLeft({ end }: { end: string }) {
  const { label } = useCountdown(end);
  return <StatusDot tone="pass" label={`Running · ${label.replace(/^0(\d):/, '$1:')} left`} />;
}

function ContestStatus({ contest }: { contest: Contest }) {
  if (contest.status === 'running') return <RunningLeft end={contest.end_time} />;
  if (contest.status === 'scheduled') return <StatusDot tone="neutral" label="Scheduled" />;
  if (contest.status === 'finishing') return <StatusDot tone="warn" label="Judging" />;
  return <StatusDot tone="neutral" label="Finished" />;
}

/** Contests list (§7.8): status segments, facts per row, ⋯ menu, create drawer. */
export default function ContestManagement() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Contest | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const {
    isRejudgeConfirmOpen, rejudgeTarget, rejudgeFeedback, handleRejudgeClick, handleCloseRejudgeConfirm, handleConfirmRejudge, dismissRejudgeFeedback,
  } = useRejudge();

  useEffect(() => {
    let cancelled = false;
    adminService.getContests()
      .then((list) => { if (!cancelled) setContests(list as Contest[]); })
      .catch((err) => { if (!cancelled) setLoadError(getErrorMessage(err, 'Failed to load contests.')); });
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (contests ?? []).filter((c) => (status === 'all' || bucketOf(c.status) === status)
      && (!query || c.title.toLowerCase().includes(query)));
  }, [contests, status, search]);

  const toggleVisibility = async (contest: Contest) => {
    setActionError('');
    try {
      await adminService.updateContestVisibility(contest.id, !contest.is_visible);
      setContests((prev) => (prev ?? []).map((c) => (c.id === contest.id ? { ...c, is_visible: !contest.is_visible } : c)));
    } catch (err) {
      setActionError(getErrorMessage(err, 'Failed to change visibility.'));
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true);
    setActionError('');
    try {
      await adminService.deleteContest(deleting.id);
      setContests((prev) => (prev ?? []).filter((c) => c.id !== deleting.id));
      setDeleting(null);
    } catch (err) {
      setActionError(getErrorMessage(err, 'Failed to delete the contest.'));
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const columns: DataTableColumn<Contest>[] = [
    { key: 'title', header: 'Title', mobile: 'primary', cell: (c) => <span className={styles.title}>{c.title}</span> },
    { key: 'status', header: 'Status', mobile: 'meta', cell: (c) => <ContestStatus contest={c} /> },
    { key: 'starts', header: 'Starts', mobile: 'meta', cell: (c) => <span className={styles.mono}>{formatBangkokStart(c.start_time)}</span> },
    {
      key: 'duration', header: 'Duration', align: 'right', mobile: 'hidden',
      cell: (c) => <span className={styles.mono}>{formatDuration(Date.parse(c.end_time) - Date.parse(c.start_time))}</span>,
    },
    { key: 'participants', header: 'Participants', align: 'right', mobile: 'hidden', cell: (c) => <span className={styles.mono}>{Number(c.participant_count ?? 0)}</span> },
    { key: 'problems', header: 'Problems', align: 'right', mobile: 'hidden', cell: (c) => <span className={styles.mono}>{Number(c.problem_count ?? 0)}</span> },
    {
      key: 'visibility', header: 'Visibility', mobile: 'hidden',
      cell: (c) => <StatusDot tone={c.is_visible ? 'pass' : 'warn'} label={c.is_visible ? 'Visible' : 'Hidden'} />,
    },
  ];

  const rowActions = (c: Contest): ActionMenuItem[] => [
    { key: 'edit', label: 'Edit', onClick: () => navigate(`/admin/contests/${c.id}`) },
    { key: 'open', label: 'Open contest page', onClick: () => navigate(`/contests/${c.id}`) },
    { key: 'visibility', label: c.is_visible ? 'Hide' : 'Show', onClick: () => { void toggleVisibility(c); } },
    ...(isAdmin ? [{
      key: 'rejudge',
      label: 'Rejudge',
      disabled: c.status === 'finished',
      title: c.status === 'finished'
        ? 'Finished contest — its scoreboard is frozen. Rejudge its problems individually instead.'
        : 'Re-run every submission in this contest against the current testcases and limits',
      onClick: () => handleRejudgeClick({ kind: 'contest', id: c.id, title: c.title }),
    }] : []),
    {
      key: 'delete',
      label: 'Delete',
      variant: 'danger' as const,
      disabled: c.status === 'running',
      title: c.status === 'running' ? 'A running contest can’t be deleted.' : undefined,
      onClick: () => setDeleting(c),
    },
  ];

  const countLabel = `${rows.length} ${rows.length === 1 ? 'contest' : 'contests'}`;

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Manage' }]}
        title="Contests"
        meta={BANGKOK_NOTE}
        actions={<Button onClick={() => setCreating(true)}>New contest</Button>}
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: 'Search contests…' }}
        segments={<SegmentedControl aria-label="Contest status" options={SEGMENTS} value={status} onChange={(v) => setStatus(v as StatusFilter)} />}
        resultCount={contests ? countLabel : undefined}
      />
      {actionError && <InlineError message={actionError} />}
      <RejudgeFeedbackBox feedback={rejudgeFeedback} onDismiss={dismissRejudgeFeedback} />
      <DataTable<Contest>
        caption="Contests"
        columns={columns}
        rows={rows}
        rowKey={(c) => String(c.id)}
        rowLabel={(c) => c.title}
        rowHref={(c) => `/admin/contests/${c.id}`}
        rowActions={rowActions}
        loading={contests === null && !loadError}
        error={loadError ? { message: loadError } : undefined}
        empty={search || status !== 'all' ? 'No contests match these filters.' : 'No contests yet. Create one to schedule a round.'}
      />

      <CreateContestDrawer
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => { setCreating(false); navigate(`/admin/contests/${id}/problems`); }}
      />
      <ConfirmDialog
        open={deleting !== null}
        tier="typed"
        confirmText={deleting?.title ?? ''}
        title={`Delete ${deleting?.title ?? ''}?`}
        body="Its problems go back to the general pool; its participants, contest submissions and scoreboard are deleted. This can't be undone."
        confirmLabel="Delete contest"
        busy={deleteBusy}
        onConfirm={() => { void remove(); }}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={isRejudgeConfirmOpen}
        tier="plain"
        title={`Rejudge ${rejudgeTarget?.title ?? ''}?`}
        body="Every submission in this contest is re-run against the current testcases and limits. Scores may change."
        confirmLabel="Rejudge"
        onConfirm={() => { void handleConfirmRejudge(); }}
        onCancel={handleCloseRejudgeConfirm}
      />
    </div>
  );
}
