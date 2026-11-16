import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Countdown, DataTable, EmptyState, StatusBadge, type DataTableColumn } from '../../components/ui';
import contestService from '../../services/contestService';
import problemService from '../../services/problemService';
import type { Contest, ProblemSummary } from '../../types';
import styles from './GuestHome.module.css';

const STARTER_COUNT = 6;

/** Public-mode guest home (§7.10): a plain intro, live/upcoming contests, problems to start with. */
export default function GuestHome() {
  const [contests, setContests] = useState<Contest[]>([]);
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    contestService.getAll()
      .then((data) => {
        if (cancelled) return;
        setContests(data
          .filter((c) => c.status === 'running' || c.status === 'scheduled')
          .sort((a, b) => (a.status === b.status ? 0 : a.status === 'running' ? -1 : 1)));
      })
      .catch(() => { /* Contests are supplementary on the guest home. */ });
    problemService.getProblemsPage({ sort: 'difficulty', order: 'asc', limit: STARTER_COUNT })
      .then((page) => { if (!cancelled) setProblems(page.problems); })
      .catch(() => { if (!cancelled) setProblems([]); });
    return () => { cancelled = true; };
  }, []);

  const columns: DataTableColumn<ProblemSummary>[] = [
    { key: 'id', header: 'ID', mobile: 'meta', cell: (p) => <span className={styles.mono}>{p.id}</span> },
    { key: 'title', header: 'Title', mobile: 'primary', cell: (p) => p.title },
    { key: 'difficulty', header: 'Difficulty', align: 'right', mobile: 'meta', cell: (p) => p.difficulty ?? '—' },
  ];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Grader</h1>
        <p className={styles.lead}>Practice problems in C++ and Python, judged in seconds. Browse freely; log in to submit.</p>
      </header>

      {contests.length > 0 && (
        <section className={styles.section} aria-label="Contests">
          <h2 className={styles.sectionLabel}>Contests</h2>
          <ul className={styles.contests}>
            {contests.map((contest) => (
              <li key={contest.id} className={styles.contest}>
                <StatusBadge tone={contest.status === 'running' ? 'success' : 'neutral'}>
                  {contest.status === 'running' ? 'LIVE' : 'UPCOMING'}
                </StatusBadge>
                <span className={styles.contestTitle}>{contest.title}</span>
                <Countdown contest={contest} />
                <Link
                  to={`/login?returnTo=${encodeURIComponent(`/contests/${contest.id}`)}`}
                  className={styles.join}
                >
                  Log in to join
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className={styles.section} aria-label="Start with these problems">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionLabel}>Start with these problems</h2>
          <Link to="/problems" className={styles.all}>All problems →</Link>
        </div>
        <DataTable<ProblemSummary>
          caption="Start with these problems"
          columns={columns}
          rows={problems ?? []}
          rowKey={(p) => p.id}
          rowLabel={(p) => p.title}
          rowHref={(p) => `/problems/${p.id}`}
          loading={problems === null}
          empty={<EmptyState title="No problems yet." />}
        />
      </section>
    </div>
  );
}
