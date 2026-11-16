import { useNavigate } from 'react-router-dom';
import { Button, Countdown, InlineError, InlineNotice, PageHeader, StatusBadge } from '../../components/ui';
import contestService from '../../services/contestService';
import type { Contest } from '../../types';
import { formatWindow } from './format';
import { problemLetter } from './letters';
import { useJoinContest } from './useJoinContest';
import styles from './ContestStates.module.css';

/** Running contest the viewer hasn't joined (§7.7): letters only, Join lands on problem A. */
export default function ContestJoinGate({ contest }: { contest: Contest }) {
  const navigate = useNavigate();
  const { join, joining, error } = useJoinContest(contest.id);
  const count = Number(contest.problem_count ?? 0);

  const joinAndEnter = async () => {
    if (!(await join())) return;
    const problems = await contestService.getProblems(contest.id).catch(() => []);
    const first = (problems as Array<{ id: string }>)[0];
    navigate(first ? `/contests/${contest.id}/problems/${first.id}` : `/contests/${contest.id}/problems`);
  };

  return (
    <div className={styles.page}>
      <PageHeader
        breadcrumb={[{ label: 'Contests', to: '/contests' }, { label: contest.title }]}
        title={<>{contest.title} <StatusBadge tone="success">LIVE</StatusBadge></>}
        meta={<span className={styles.metaLine}><span className={styles.mono}>{formatWindow(contest.start_time, contest.end_time)}</span> · <Countdown contest={contest} /> · {`${Number(contest.participant_count ?? 0)} joined`}</span>}
        actions={<Button onClick={joinAndEnter} loading={joining} loadingLabel="Joining…">Join contest</Button>}
      />
      {error && <InlineError message={error} />}
      <InlineNotice>Problem titles show once you join. Joining starts your scoring; you land on problem A.</InlineNotice>
      <table className={styles.table} aria-label="Problems">
        <thead><tr><th scope="col">#</th><th scope="col">Problem</th></tr></thead>
        <tbody>
          {Array.from({ length: count }, (_, i) => (
            <tr key={i}><td className={styles.letter}>{problemLetter(i)}</td><td className={styles.hiddenTitle}>Hidden until you join</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
