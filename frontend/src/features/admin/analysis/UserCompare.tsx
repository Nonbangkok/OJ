import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { fetchUserAnalytics, UserAnalytics } from '../../../services/analyticsService';
import styles from './UserDetail.module.css';

interface UserCompareProps {
  userIds: [number, number];
  onBack: () => void;
}

interface LoadState {
  a: UserAnalytics | null;
  b: UserAnalytics | null;
  error: string | null;
}

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

/** Side-by-side KPI comparison of two users (analysis Users tab). */
const UserCompare = ({ userIds, onBack }: UserCompareProps) => {
  const [state, setState] = useState<LoadState>({ a: null, b: null, error: null });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setState({ a: null, b: null, error: null });
      try {
        const [a, b] = await Promise.all([
          fetchUserAnalytics(userIds[0]),
          fetchUserAnalytics(userIds[1]),
        ]);
        if (!cancelled) setState({ a, b, error: null });
      } catch {
        if (!cancelled) setState({ a: null, b: null, error: 'Failed to load user analytics. Please try again.' });
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [userIds]);

  if (state.error) {
    return (
      <div>
        <p className={styles.error}>{state.error}</p>
        <button type="button" onClick={onBack} className={styles['back-button']}>← Back to users</button>
      </div>
    );
  }

  if (!state.a || !state.b) {
    return <p className={styles.loading}>Loading comparison…</p>;
  }

  const { a, b } = state;

  const rows: Array<{ label: string; render: (u: UserAnalytics) => string }> = [
    { label: 'Submissions', render: (u) => String(u.kpis.submissions) },
    { label: 'Solved', render: (u) => String(u.kpis.solved) },
    { label: 'Attempted', render: (u) => String(u.kpis.attempted) },
    { label: 'AC rate', render: (u) => formatPercent(u.kpis.acRate) },
    { label: 'Total score', render: (u) => String(u.kpis.totalScore) },
  ];

  return (
    <div className={styles.container}>
      <button type="button" onClick={onBack} className={styles['back-button']}>← Back to users</button>
      <h3 className={styles.title}>
        <Link to={`/profile/${a.user.username}`}>{a.user.username}</Link>
        {' vs '}
        <Link to={`/profile/${b.user.username}`}>{b.user.username}</Link>
      </h3>
      <div>
        <table className={styles['compare-table']}>
          <thead>
            <tr>
              <th>Metric</th>
              <th>{a.user.username}</th>
              <th>{b.user.username}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, render }) => (
              <tr key={label}>
                <td>{label}</td>
                <td>{render(a)}</td>
                <td>{render(b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserCompare;
