import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchOverview, OverviewAnalytics } from '../../../services/analyticsService';
import ChartCard from './components/ChartCard';
import KpiCard from './components/KpiCard';
import { useChartColors, VERDICT_COLORS } from './analysisCharts';
import styles from './OverviewTab.module.css';

const DAY_OPTIONS = [7, 30, 90, 0];

const rangeLabel = (days: number): string => {
  if (days === 0) return 'All time';
  return days === 30 ? 'Last 30 days' : `${days} days`;
};

const deltaPercent = (current: number, previous: number): number | null => {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

/** Deltas are meaningless for all-time (no previous window to compare). */
const windowDelta = (allTime: boolean, current: number, previous: number): number | null =>
  allTime ? null : deltaPercent(current, previous);

const OverviewTab = () => {
  const [days, setDays] = useState(30);
  const allTime = days === 0;
  const [data, setData] = useState<OverviewAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colors = useChartColors();

  const load = useCallback(async (windowDays: number) => {
    setError(null);
    try {
      setData(await fetchOverview(windowDays));
    } catch {
      setError('Failed to load analytics. Please try again.');
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.loading}>Loading analytics…</p>;

  const { kpis } = data;

  return (
    <div className={styles.container}>
      <div className={styles['range-selector']} role="group" aria-label="Time range">
        {DAY_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            className={option === days ? styles['range-active'] : styles['range-button']}
            onClick={() => setDays(option)}
          >
            {rangeLabel(option)}
          </button>
        ))}
      </div>

      <div className={styles['kpi-row']}>
        <KpiCard label="Submissions" value={kpis.submissions.current} deltaPercent={windowDelta(allTime, kpis.submissions.current, kpis.submissions.previous)} />
        <KpiCard label="Unique submitters" value={kpis.uniqueSubmitters.current} deltaPercent={windowDelta(allTime, kpis.uniqueSubmitters.current, kpis.uniqueSubmitters.previous)} />
        <KpiCard label="Accepted" value={kpis.accepted.current} deltaPercent={windowDelta(allTime, kpis.accepted.current, kpis.accepted.previous)} />
        <KpiCard label="New users" value={kpis.newUsers.current} deltaPercent={windowDelta(allTime, kpis.newUsers.current, kpis.newUsers.previous)} />
        <KpiCard label="Active problems" value={kpis.activeProblems.current} deltaPercent={windowDelta(allTime, kpis.activeProblems.current, kpis.activeProblems.previous)} />
      </div>

      <ChartCard title="Submissions per day">
        <ResponsiveContainer>
          <LineChart data={data.dailySeries}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke={colors.text} />
            <YAxis stroke={colors.text} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="total" name="Submissions" stroke={colors.series[0]} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="accepted" name="Accepted" stroke={colors.series[1]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className={styles['chart-grid']}>
        <ChartCard title="Verdict distribution">
          <ResponsiveContainer>
            <BarChart data={data.verdictBreakdown}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
              <XAxis dataKey="verdict" stroke={colors.text} />
              <YAxis stroke={colors.text} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Submissions">
                {data.verdictBreakdown.map((entry) => (
                  <Cell key={entry.verdict} fill={VERDICT_COLORS[entry.verdict] ?? colors.series[2]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Verdict share">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.verdictBreakdown} dataKey="count" nameKey="verdict" label={false}>
                {data.verdictBreakdown.map((entry) => (
                  <Cell key={entry.verdict} fill={VERDICT_COLORS[entry.verdict] ?? colors.series[2]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className={styles['chart-grid']}>
        <div className={styles['table-card']}>
          <h3>Top problems</h3>
          <table>
            <thead>
              <tr><th>Problem</th><th>Submissions</th><th>Accepted</th></tr>
            </thead>
            <tbody>
              {data.topProblems.map((p) => (
                <tr key={p.problemId}>
                  <td><Link to={`/problems/${p.problemId}`}>{p.title}</Link></td>
                  <td>{p.submissions}</td>
                  <td>{p.accepted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={styles['table-card']}>
          <h3>Top submitters</h3>
          <table>
            <thead>
              <tr><th>User</th><th>Submissions</th><th>Solved</th></tr>
            </thead>
            <tbody>
              {data.topSubmitters.map((u) => (
                <tr key={u.userId}>
                  <td><Link to={`/profile/${u.username}`}>{u.username}</Link></td>
                  <td>{u.submissions}</td>
                  <td>{u.solved}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className={styles['table-card']}>
        <h3>Recent contests</h3>
        <table>
          <thead>
            <tr><th>Contest</th><th>Status</th><th>Submissions</th><th>Participants</th><th>Avg score</th></tr>
          </thead>
          <tbody>
            {data.contestStats.map((c) => (
              <tr key={c.contestId}>
                <td>{c.title}</td>
                <td>{c.status}</td>
                <td>{c.submissions}</td>
                <td>{c.participants}</td>
                <td>{c.avgScore.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OverviewTab;
