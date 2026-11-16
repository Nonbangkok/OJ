import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchOverview, OverviewAnalytics } from '../../../services/analyticsService';
import { Button } from '../../../components/ui';
import { downloadCsv } from '../../../utils/downloadCsv';
import ChartCard from './components/ChartCard';
import KpiCard from './components/KpiCard';
import { DAILY_VERDICT_SERIES, useChartColors, useVerdictColors, verdictKeyOf } from './analysisCharts';
import styles from './OverviewTab.module.css';

const deltaPercent = (current: number, previous: number): number | null => {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
};

/** Deltas are meaningless for all-time (no previous window to compare). */
const windowDelta = (allTime: boolean, current: number, previous: number): number | null =>
  allTime ? null : deltaPercent(current, previous);

function TableCard({ title, file, rows, children }: { title: string; file: string; rows: string[][]; children: React.ReactNode }) {
  return (
    <div className={styles['table-card']}>
      <div className={styles['table-head']}>
        <h3>{title}</h3>
        <Button size="compact" variant="secondary" aria-label={`Export ${title} as CSV`} disabled={rows.length <= 1} onClick={() => downloadCsv(file, rows)}>
          Export CSV
        </Button>
      </div>
      {children}
    </div>
  );
}

interface OverviewTabProps {
  /** Window in days; 0 = all time. */
  days: number;
  /** Short window label for deltas and file names, e.g. "30d" or "all". */
  rangeKey: string;
}

const OverviewTab = ({ days, rangeKey }: OverviewTabProps) => {
  const allTime = days === 0;
  const [data, setData] = useState<OverviewAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colors = useChartColors();
  const verdictColors = useVerdictColors();

  // Promise callbacks (not try/await) so state is only set once the request
  // settles; starting from Promise.resolve() also routes a synchronous throw
  // into the error callback.
  const load = useCallback((windowDays: number) => Promise.resolve().then(() => fetchOverview(windowDays)).then(
    (overview) => { setData(overview); setError(null); },
    () => { setError('Failed to load analytics. Please try again.'); },
  ), []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  if (error) return <p className={styles.error}>{error}</p>;
  if (!data) return <p className={styles.loading}>Loading analytics…</p>;

  const { kpis } = data;
  const kpi = (label: string, value: { current: number; previous: number }) => (
    <KpiCard label={label} value={value.current} deltaPercent={windowDelta(allTime, value.current, value.previous)} comparison={rangeKey} />
  );

  return (
    <div className={styles.container}>
      <div className={styles['kpi-row']}>
        {kpi('Submissions', kpis.submissions)}
        {kpi('Unique submitters', kpis.uniqueSubmitters)}
        {kpi('Accepted', kpis.accepted)}
        {kpi('New users', kpis.newUsers)}
        {kpi('Active problems', kpis.activeProblems)}
      </div>

      <ChartCard title="Submissions per day">
        <ResponsiveContainer>
          <BarChart data={data.dailySeries}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" stroke={colors.text} />
            <YAxis stroke={colors.text} allowDecimals={false} />
            <Tooltip />
            <Legend />
            {DAILY_VERDICT_SERIES.map((series) => (
              <Bar key={series.key} dataKey={series.key} name={series.label} stackId="verdict" fill={verdictColors[series.key]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Verdict distribution">
        <ResponsiveContainer>
          <BarChart data={data.verdictBreakdown}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="verdict" stroke={colors.text} />
            <YAxis stroke={colors.text} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" name="Submissions">
              {data.verdictBreakdown.map((entry) => (
                <Cell key={entry.verdict} fill={verdictColors[verdictKeyOf(entry.verdict)]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className={styles['chart-grid']}>
        <TableCard
          title="Top problems"
          file={`top-problems-${rangeKey}.csv`}
          rows={[['Problem', 'ID', 'Submissions', 'Accepted'], ...data.topProblems.map((p) => [p.title, p.problemId, String(p.submissions), String(p.accepted)])]}
        >
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
        </TableCard>

        <TableCard
          title="Top submitters"
          file={`top-submitters-${rangeKey}.csv`}
          rows={[['User', 'Submissions', 'Solved'], ...data.topSubmitters.map((u) => [u.username, String(u.submissions), String(u.solved)])]}
        >
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
        </TableCard>
      </div>

      <TableCard
        title="Recent contests"
        file={`recent-contests-${rangeKey}.csv`}
        rows={[['Contest', 'Status', 'Submissions', 'Participants', 'Avg score'], ...data.contestStats.map((c) => [c.title, c.status, String(c.submissions), String(c.participants), c.avgScore.toFixed(1)])]}
      >
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
      </TableCard>
    </div>
  );
};

export default OverviewTab;
