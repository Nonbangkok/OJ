import { useEffect, useState } from 'react';
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
import { fetchUserAnalytics, UserAnalytics } from '../../../services/analyticsService';
import ChartCard from './components/ChartCard';
import KpiCard from './components/KpiCard';
import VerdictBadge from './components/VerdictBadge';
import { useChartColors, VERDICT_COLORS } from './analysisCharts';
import styles from './UserDetail.module.css';

interface UserDetailProps {
  userId: number;
  onBack: () => void;
}

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const UserDetail = ({ userId, onBack }: UserDetailProps) => {
  const [data, setData] = useState<UserAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colors = useChartColors();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);
      try {
        const result = await fetchUserAnalytics(userId);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setError('Failed to load user analytics. Please try again.');
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [userId]);

  if (error) {
    return (
      <div>
        <p className={styles.error}>{error}</p>
        <button type="button" onClick={onBack} className={styles['back-button']}>← Back to users</button>
      </div>
    );
  }
  if (!data) return <p className={styles.loading}>Loading user analytics…</p>;

  const { kpis } = data;

  return (
    <div className={styles.container}>
      <button type="button" onClick={onBack} className={styles['back-button']}>← Back to users</button>
      <h3 className={styles.title}>{data.user.username}</h3>
      <p className={styles.subtitle}>Member since {new Date(data.user.createdAt).toLocaleDateString()}</p>

      <div className={styles['kpi-row']}>
        <KpiCard label="Submissions" value={kpis.submissions} deltaPercent={null} />
        <KpiCard label="Solved" value={kpis.solved} deltaPercent={null} />
        <KpiCard label="Attempted" value={kpis.attempted} deltaPercent={null} />
        <KpiCard label="AC rate" value={formatPercent(kpis.acRate)} deltaPercent={null} />
        <KpiCard label="Total score" value={kpis.totalScore} deltaPercent={null} />
      </div>

      <ChartCard title="Submissions per day">
        <ResponsiveContainer>
          <LineChart data={data.dailySeries}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="day" stroke={colors.text} />
            <YAxis stroke={colors.text} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="count" name="Submissions" stroke={colors.series[0]} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className={styles['chart-grid']}>
        <ChartCard title="Activity by hour of day">
          <ResponsiveContainer>
            <BarChart data={data.hourHistogram}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
              <XAxis dataKey="hour" stroke={colors.text} />
              <YAxis stroke={colors.text} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Submissions" fill={colors.series[0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Language usage">
          <ResponsiveContainer>
            <BarChart data={data.languageBreakdown}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
              <XAxis dataKey="language" stroke={colors.text} />
              <YAxis stroke={colors.text} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Submissions" fill={colors.series[1]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className={styles['chart-grid']}>
        <ChartCard title="Verdicts">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data.verdictBreakdown} dataKey="count" nameKey="verdict">
                {data.verdictBreakdown.map((entry) => (
                  <Cell key={entry.verdict} fill={VERDICT_COLORS[entry.verdict] ?? colors.series[2]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Cumulative solved">
          <ResponsiveContainer>
            <LineChart data={data.cumulativeSolved}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke={colors.text} />
              <YAxis stroke={colors.text} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="solved" name="Solved (cumulative)" stroke={colors.series[1]} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Solved by category">
        <ResponsiveContainer>
          <BarChart data={data.solvedByCategory}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="category" stroke={colors.text} />
            <YAxis stroke={colors.text} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="solved" name="Solved" fill={colors.series[1]} />
            <Bar dataKey="attempted" name="Attempted" fill={colors.series[0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className={styles['verdict-list']}>
        {data.verdictBreakdown.map((entry) => (
          <span key={entry.verdict} className={styles['verdict-item']}>
            <VerdictBadge verdict={entry.verdict} /> × {entry.count}
          </span>
        ))}
      </div>
    </div>
  );
};

export default UserDetail;
