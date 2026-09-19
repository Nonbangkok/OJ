import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ContestAnalytics, fetchContestAnalytics } from '../../../services/analyticsService';
import ChartCard from './components/ChartCard';
import KpiCard from './components/KpiCard';
import { useChartColors } from './analysisCharts';
import styles from './ContestDetail.module.css';

interface ContestDetailProps {
  contestId: number;
  onBack: () => void;
}

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatDateTime = (iso: string): string => new Date(iso).toLocaleString();

const ContestDetail = ({ contestId, onBack }: ContestDetailProps) => {
  const [data, setData] = useState<ContestAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colors = useChartColors();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);
      try {
        const result = await fetchContestAnalytics(contestId);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setError('Failed to load contest analytics. Please try again.');
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [contestId]);

  if (error) {
    return (
      <div>
        <p className={styles.error}>{error}</p>
        <button type="button" onClick={onBack} className={styles['back-button']}>← Back to contests</button>
      </div>
    );
  }
  if (!data) return <p className={styles.loading}>Loading contest analytics…</p>;

  const { kpis } = data;

  return (
    <div className={styles.container}>
      <button type="button" onClick={onBack} className={styles['back-button']}>← Back to contests</button>
      <h3 className={styles.title}>{data.contest.title}</h3>
      <p className={styles.subtitle}>
        {formatDateTime(data.contest.startTime)} – {formatDateTime(data.contest.endTime)} · {data.contest.status}
      </p>

      <div className={styles['kpi-row']}>
        <KpiCard label="Participants" value={kpis.participants} deltaPercent={null} />
        <KpiCard label="Submitters" value={kpis.submitters} deltaPercent={null} />
        <KpiCard label="Submissions" value={kpis.submissions} deltaPercent={null} />
        <KpiCard label="Accepted" value={kpis.accepted} deltaPercent={null} />
        <KpiCard label="Avg score" value={kpis.avgScore.toFixed(1)} deltaPercent={null} />
        <KpiCard label="Top score" value={kpis.maxScore} deltaPercent={null} />
      </div>

      <ChartCard title="Submissions over time">
        <ResponsiveContainer>
          <BarChart data={data.submissionTimeline}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="bucket" stroke={colors.text} />
            <YAxis stroke={colors.text} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" name="Submissions" fill={colors.series[0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Per-problem results">
        <ResponsiveContainer>
          <BarChart data={data.problemStats}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="title" stroke={colors.text} />
            <YAxis stroke={colors.text} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="submissions" name="Submissions" fill={colors.series[0]} />
            <Bar dataKey="accepted" name="Accepted" fill={colors.series[1]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className={styles['table-card']}>
        <h3>Problem breakdown</h3>
        <table>
          <thead>
            <tr><th>Problem</th><th>Submissions</th><th>Accepted</th><th>AC rate</th><th>Solvers</th></tr>
          </thead>
          <tbody>
            {data.problemStats.map((p) => (
              <tr key={p.problemId}>
                <td>{p.title}</td>
                <td>{p.submissions}</td>
                <td>{p.accepted}</td>
                <td>{formatPercent(p.acRate)}</td>
                <td>{p.solvers}</td>
              </tr>
            ))}
            {data.problemStats.length === 0 && (
              <tr><td colSpan={5} className={styles.empty}>No problems in this contest.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className={styles['table-card']}>
        <h3>Scoreboard</h3>
        <table>
          <thead>
            <tr><th>#</th><th>User</th><th>Score</th><th>Solved</th></tr>
          </thead>
          <tbody>
            {data.scoreboard.map((entry, index) => (
              <tr key={entry.username}>
                <td>{index + 1}</td>
                <td><Link to={`/profile/${entry.username}`}>{entry.username}</Link></td>
                <td>{entry.totalScore}</td>
                <td>{entry.solved}</td>
              </tr>
            ))}
            {data.scoreboard.length === 0 && (
              <tr><td colSpan={4} className={styles.empty}>No participants yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ContestDetail;
