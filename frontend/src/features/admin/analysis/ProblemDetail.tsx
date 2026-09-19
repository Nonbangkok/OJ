import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fetchProblemAnalytics, ProblemAnalytics } from '../../../services/analyticsService';
import ChartCard from './components/ChartCard';
import KpiCard from './components/KpiCard';
import { useChartColors, VERDICT_COLORS } from './analysisCharts';
import styles from './ProblemDetail.module.css';

interface ProblemDetailProps {
  problemId: string;
  onBack: () => void;
}

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

const formatDateTime = (iso: string): string => new Date(iso).toLocaleString();

const ProblemDetail = ({ problemId, onBack }: ProblemDetailProps) => {
  const [data, setData] = useState<ProblemAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const colors = useChartColors();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setError(null);
      try {
        const result = await fetchProblemAnalytics(problemId);
        if (!cancelled) setData(result);
      } catch {
        if (!cancelled) setError('Failed to load problem analytics. Please try again.');
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [problemId]);

  if (error) {
    return (
      <div>
        <p className={styles.error}>{error}</p>
        <button type="button" onClick={onBack} className={styles['back-button']}>← Back to problems</button>
      </div>
    );
  }
  if (!data) return <p className={styles.loading}>Loading problem analytics…</p>;

  const { kpis } = data;

  return (
    <div className={styles.container}>
      <button type="button" onClick={onBack} className={styles['back-button']}>← Back to problems</button>
      <h3 className={styles.title}>{data.problem.title}</h3>
      <p className={styles.subtitle}>Created {new Date(data.problem.createdAt).toLocaleDateString()}</p>

      <div className={styles['kpi-row']}>
        <KpiCard label="Submissions" value={kpis.submissions} deltaPercent={null} />
        <KpiCard label="Accepted" value={kpis.accepted} deltaPercent={null} />
        <KpiCard label="AC rate" value={formatPercent(kpis.acRate)} deltaPercent={null} />
        <KpiCard label="Unique submitters" value={kpis.uniqueSubmitters} deltaPercent={null} />
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

      <ChartCard title="Testcase pass rate">
        <ResponsiveContainer>
          <BarChart data={data.testcasePassRates}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
            <XAxis dataKey="caseNumber" stroke={colors.text} />
            <YAxis stroke={colors.text} domain={[0, 1]} tickFormatter={formatPercent} />
            <Tooltip formatter={(value: number) => formatPercent(value)} />
            <Bar dataKey="passRate" name="Pass rate" fill={colors.series[0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <div className={styles['chart-grid']}>
        <ChartCard title="Runtime distribution">
          <ResponsiveContainer>
            <BarChart data={data.runtimeBuckets}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
              <XAxis dataKey="bucket" stroke={colors.text} />
              <YAxis stroke={colors.text} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Submissions" fill={colors.series[1]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Memory distribution">
          <ResponsiveContainer>
            <BarChart data={data.memoryBuckets}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 3" />
              <XAxis dataKey="bucket" stroke={colors.text} />
              <YAxis stroke={colors.text} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Submissions" fill={colors.series[2]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className={styles['table-card']}>
        <h3>First solves</h3>
        <table>
          <thead>
            <tr><th>#</th><th>User</th><th>Solved at</th></tr>
          </thead>
          <tbody>
            {data.firstSolves.map((solve, index) => (
              <tr key={solve.userId}>
                <td>{index + 1}</td>
                <td><Link to={`/profile/${solve.username}`}>{solve.username}</Link></td>
                <td>{formatDateTime(solve.submittedAt)}</td>
              </tr>
            ))}
            {data.firstSolves.length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>No accepted submissions yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ProblemDetail;
