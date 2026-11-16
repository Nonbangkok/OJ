import { Link } from 'react-router-dom';
import { Countdown } from '../../components/ui';
import type { Contest } from '../../types';
import styles from './Home.parts.module.css';

const SHOWN = 3;
const time = (value: string) => new Date(value).getTime();

/** Running contests (soonest end first), then upcoming ones (soonest start). */
export const homeContests = (contests: Contest[]): Contest[] => [
  ...contests.filter((c) => c.status === 'running').sort((a, b) => time(a.end_time) - time(b.end_time)),
  ...contests.filter((c) => c.status === 'scheduled').sort((a, b) => time(a.start_time) - time(b.start_time)),
].slice(0, SHOWN);

export default function ContestsPanel({ contests }: { contests: Contest[] }) {
  const shown = homeContests(contests);
  if (shown.length === 0) return null;
  return (
    <section className={styles.panel} aria-labelledby="home-contests">
      <div className={styles.sectionHead}>
        <h2 id="home-contests" className={styles.sectionLabel}>Contests</h2>
        <Link to="/contests" className={styles.headLink}>All contests</Link>
      </div>
      <ul className={styles.contestList}>
        {shown.map((contest) => (
          <li key={contest.id} className={styles.contestItem}>
            <Link to={`/contests/${contest.id}`} className={styles.contestName}>{contest.title}</Link>
            <Countdown contest={contest} />
          </li>
        ))}
      </ul>
    </section>
  );
}
