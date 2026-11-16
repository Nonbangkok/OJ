import { Link, useNavigate } from 'react-router-dom';
import { Check } from '@phosphor-icons/react';
import { useAuth } from '../../context/AuthContext';
import { useContests } from '../../hooks/useContests';
import LoadingPage from '../../components/shared/LoadingPage';
import { Button, Countdown, EmptyState, InlineError, PageHeader, StatusBadge } from '../../components/ui';
import type { Contest } from '../../types';
import { formatWindow, plural } from '../../features/contest/format';
import styles from './Contests.module.css';

type Group = { key: 'live' | 'upcoming' | 'past'; title: string; contests: Contest[] };

const groupContests = (contests: Contest[]): Group[] => {
  const by = (pick: (c: Contest) => boolean) => contests.filter(pick);
  const time = (iso: string) => new Date(iso).getTime();
  return [
    { key: 'live' as const, title: 'Live', contests: by((c) => c.status === 'running' || c.status === 'finishing').sort((a, b) => time(a.end_time) - time(b.end_time)) },
    { key: 'upcoming' as const, title: 'Upcoming', contests: by((c) => c.status === 'scheduled').sort((a, b) => time(a.start_time) - time(b.start_time)) },
    { key: 'past' as const, title: 'Past', contests: by((c) => c.status === 'finished').sort((a, b) => time(b.end_time) - time(a.end_time)) },
  ];
};

/** Contests list (§7.7): Live / Upcoming / Past, one action per row. */
const Contests = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { contests, loading, error, joinContest } = useContests();
  const isStaff = user?.role === 'admin' || user?.role === 'staff';

  if (loading) return <LoadingPage />;

  const groups = groupContests(contests as Contest[]);
  const count = (key: Group['key']) => groups.find((g) => g.key === key)?.contests.length ?? 0;

  const join = async (contest: Contest) => {
    const result = await joinContest(contest.id);
    if (result.success && contest.status === 'running') navigate(`/contests/${contest.id}`);
  };

  const action = (contest: Contest) => {
    if (contest.status === 'running') {
      return contest.is_participant
        ? <Link to={`/contests/${contest.id}/problems`} className={`${styles.action} ${styles.primary}`}>Enter</Link>
        : <Button size="compact" onClick={() => join(contest)}>Join</Button>;
    }
    if (contest.status === 'scheduled') {
      return contest.is_participant
        ? <Link to={`/contests/${contest.id}`} className={styles.action}><Check size={14} aria-hidden="true" />Registered</Link>
        : <Button size="compact" variant="secondary" onClick={() => join(contest)}>Join</Button>;
    }
    return <Link to={`/contests/${contest.id}`} className={`${styles.action} ${styles.quiet}`}>Results</Link>;
  };

  return (
    <div className={styles.container}>
      <PageHeader
        title="Contests"
        meta={contests.length > 0 ? `${count('live')} live · ${count('upcoming')} upcoming · ${count('past')} past` : undefined}
      />
      {error && <InlineError message={error} />}
      {contests.length === 0 && !error && <EmptyState title="No contests yet." />}
      {groups.filter((g) => g.contests.length > 0).map((group) => (
        <section key={group.key} className={styles.group} aria-labelledby={`contests-${group.key}`}>
          <h2 id={`contests-${group.key}`} className={styles.groupTitle}>{group.title}</h2>
          <ul className={styles.rows}>
            {group.contests.map((contest) => (
              <li key={contest.id} className={styles.row}>
                <span className={styles.title}>
                  {contest.title}
                  {isStaff && contest.is_visible === false && <StatusBadge tone="warning">HIDDEN</StatusBadge>}
                </span>
                <span className={styles.window}>{formatWindow(contest.start_time, contest.end_time)}</span>
                <span className={styles.clock}><Countdown contest={contest} /></span>
                <span className={styles.counts}>
                  {`${Number(contest.participant_count ?? 0)} joined · ${plural(Number(contest.problem_count ?? 0), 'problem')}`}
                </span>
                <span className={styles.actionCell}>{action(contest)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

export default Contests;
