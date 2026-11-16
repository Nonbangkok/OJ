import { useEffect, useRef, useState } from 'react';
import { Check } from '@phosphor-icons/react';
import { Button, InlineError, PageHeader, StatusBadge } from '../../components/ui';
import { useCountdown } from '../../components/shell/useCountdown';
import contestService from '../../services/contestService';
import type { Contest } from '../../types';
import { useContest } from './ContestContext';
import { useJoinContest } from './useJoinContest';
import { formatDuration, formatTimeRange } from './format';
import styles from './ContestStates.module.css';

const WHEN = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
export const SCORING_RULE = 'IOI · sum of best scores · ties by earliest last improvement';

/** Scheduled contest (§7.7): countdown, rules, the registered roster, Join → Registered. */
export default function ContestLobby({ contest }: { contest: Contest }) {
  const { reload } = useContest();
  const { join, joining, error } = useJoinContest(contest.id);
  const { label, done } = useCountdown(contest.start_time);
  const [roster, setRoster] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    contestService.getScoreboard(contest.id)
      .then((data) => { if (!cancelled) setRoster(data.scoreboard.map((row) => row.username)); })
      .catch(() => { if (!cancelled) setRoster([]); });
    return () => { cancelled = true; };
  }, [contest.id, contest.is_participant]);

  // At zero, ask once whether the contest has started; the layout swaps the page when it has.
  const askedAtZero = useRef(false);
  useEffect(() => {
    if (!done || askedAtZero.current) return;
    askedAtZero.current = true;
    reload();
  }, [done, reload]);

  const action = contest.is_participant
    ? <Button variant="secondary" disabled><Check size={14} aria-hidden="true" />Registered</Button>
    : <Button onClick={join} loading={joining} loadingLabel="Joining…">Join</Button>;

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Contests', to: '/contests' }, { label: contest.title }]}
        title={<>{contest.title} <StatusBadge>SCHEDULED</StatusBadge></>}
        actions={action}
      />
      {error && <InlineError message={error} />}
      <p className={styles.label}>Starts in</p>
      <p className={styles.big} data-testid="lobby-countdown" aria-live="off">{done ? 'Starting…' : label}</p>
      <p className={styles.sub}>{`${WHEN.format(new Date(contest.start_time))} — you'll be taken in automatically.`}</p>

      <ul className={styles.facts} aria-label="Contest rules">
        <li><span>Window</span><b className={styles.mono}>{formatTimeRange(contest.start_time, contest.end_time)}</b></li>
        <li><span>Duration</span><b className={styles.mono}>{formatDuration(contest.start_time, contest.end_time)}</b></li>
        <li><span>Problems</span><b className={styles.mono}>{String(contest.problem_count ?? 0)}</b></li>
        <li><span>Scoring</span><b>{SCORING_RULE}</b></li>
      </ul>

      {roster !== null && (
        <section aria-labelledby="lobby-roster">
          <h2 id="lobby-roster" className={styles.sectionTitle}>{`Registered · ${roster.length}`}</h2>
          {roster.length === 0
            ? <p className={styles.sub}>No one has registered yet.</p>
            : (
              <ul className={styles.roster}>
                {roster.map((name) => (
                  <li key={name}><span className={styles.avatar} aria-hidden="true">{name[0]?.toUpperCase()}</span>{name}</li>
                ))}
              </ul>
            )}
        </section>
      )}
    </div>
  );
}
