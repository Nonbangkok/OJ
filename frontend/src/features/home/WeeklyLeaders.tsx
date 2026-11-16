import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import scoreboardService from '../../services/scoreboardService';
import type { GlobalRanking } from '../../types';
import styles from './Home.parts.module.css';

const SHOWN = 5;

/** The week's top XP earners, and your own place when you are not among them. */
export default function WeeklyLeaders({ username }: { username: string }) {
  const [ranking, setRanking] = useState<GlobalRanking | null>(null);
  useEffect(() => {
    let cancelled = false;
    scoreboardService.getRanking('week', 1)
      .then((data) => { if (!cancelled) setRanking(data); })
      .catch(() => { if (!cancelled) setRanking(null); });
    return () => { cancelled = true; };
  }, []);
  if (!ranking) return null;

  const top = ranking.rows.slice(0, SHOWN);
  const viewer = ranking.viewer && !top.some((row) => row.username === ranking.viewer?.username) ? ranking.viewer : null;
  return (
    <section className={styles.section} aria-labelledby="home-leaders">
      <div className={styles.sectionHead}>
        <h2 id="home-leaders" className={styles.sectionLabel}>Top this week</h2>
        <Link to="/scoreboard?window=week" className={styles.headLink} aria-label="Ranking">Ranking</Link>
      </div>
      {top.length === 0 ? (
        <p className={styles.empty}>Nobody has earned XP this week yet — be the first.</p>
      ) : (
        <ol className={styles.rows}>
          {[...top, ...(viewer ? [viewer] : [])].map((row) => {
            const you = row.username === username;
            return (
              <li key={row.username} className={you ? `${styles.row} ${styles.rowYou}` : styles.row} data-gap={row === viewer || undefined}>
                <span className={styles.rank}>{row.rank}</span>
                {you
                  ? <span className={styles.rowTitle}>You</span>
                  : <Link to={`/profile/${row.username}`} className={styles.rowTitle}>{row.username}</Link>}
                <span className={styles.xp}>{`+${row.xp.toLocaleString('en-US')} XP`}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
