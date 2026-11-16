import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AnalysisPage from '../../../features/admin/analysis/AnalysisPage';
import * as analyticsService from '../../../services/analyticsService';
import { downloadCsv } from '../../../utils/downloadCsv';
import { DAILY_VERDICT_SERIES } from '../../../features/admin/analysis/analysisCharts';
import { useTheme } from '../../../context/ThemeContext';

jest.mock('../../../services/analyticsService');
jest.mock('../../../utils/downloadCsv', () => ({ downloadCsv: jest.fn() }));
jest.mock('../../../context/ThemeContext', () => ({ useTheme: jest.fn() }));
jest.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => children ?? null,
  BarChart: ({ children }: { children?: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: ({ dataKey, stackId, fill }: { dataKey: string; stackId?: string; fill?: string }) => (
    <span data-testid="bar" data-key={dataKey} data-stack={stackId} data-fill={fill} />
  ),
  Cell: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null, CartesianGrid: () => null,
  LineChart: () => null, Line: () => null, PieChart: () => <div data-testid="pie" />, Pie: () => null,
}));

const day = (d: string, total: number) => ({ day: d, total, accepted: 6, wrong: 2, time: 1, memory: 0, runtime: 1, compilation: 0, other: total - 10 });
const overview = {
  kpis: {
    submissions: { current: 100, previous: 80 },
    uniqueSubmitters: { current: 10, previous: 10 },
    accepted: { current: 60, previous: 75 },
    newUsers: { current: 5, previous: 0 },
    activeProblems: { current: 2, previous: 1 },
  },
  dailySeries: [day('2026-11-18', 12), day('2026-11-19', 10)],
  verdictBreakdown: [{ verdict: 'Accepted', count: 60 }, { verdict: 'Wrong Answer', count: 40 }],
  topProblems: [{ problemId: 'aplusb', title: 'A Plus B', submissions: 30, accepted: 20 }],
  topSubmitters: [{ userId: 1, username: 'alice', submissions: 15, solved: 5 }],
  contestStats: [{ contestId: 1, title: 'Contest 1', status: 'finished', submissions: 40, participants: 8, avgScore: 250.5 }],
};

const Where = () => { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; };
const renderAt = (path: string) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/admin/analysis" element={<><AnalysisPage /><Where /></>} />
      <Route path="/admin/analysis/:tab" element={<><AnalysisPage /><Where /></>} />
    </Routes>
  </MemoryRouter>,
);

describe('AnalysisPage (§7.8)', () => {
  beforeEach(() => {
    jest.mocked(useTheme).mockReturnValue({ theme: 'light' } as ReturnType<typeof useTheme>);
    jest.mocked(analyticsService.fetchOverview).mockResolvedValue(overview as never);
    jest.mocked(analyticsService.fetchAnalyticsUsers).mockResolvedValue({ users: [], total: 0 } as never);
    jest.mocked(analyticsService.fetchRetentionAnalytics).mockResolvedValue({ idleUsers: [], neverSubmitted: [] } as never);
    jest.mocked(analyticsService.fetchUserAnalytics).mockReturnValue(new Promise(() => {}));
  });

  it('tabs are links to their own routes', async () => {
    renderAt('/admin/analysis');
    const tabs = within(screen.getByRole('tablist', { name: 'Analysis sections' }));
    expect(tabs.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    for (const key of ['overview', 'users', 'problems', 'contests', 'submissions']) {
      expect(tabs.getByRole('tab', { name: new RegExp(`^${key}$`, 'i') })).toHaveAttribute('href', expect.stringMatching(new RegExp(`^/admin/analysis/${key}`)));
    }
    await screen.findByText('Submissions per day');
  });

  it('the range lives in the header and in ?range=', async () => {
    renderAt('/admin/analysis/overview');
    await waitFor(() => expect(analyticsService.fetchOverview).toHaveBeenCalledWith(30));
    fireEvent.click(screen.getByRole('button', { name: '7d' }));
    await waitFor(() => expect(analyticsService.fetchOverview).toHaveBeenCalledWith(7));
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/analysis/overview?range=7d');
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a range from the URL is used on load', async () => {
    renderAt('/admin/analysis/overview?range=90d');
    await waitFor(() => expect(analyticsService.fetchOverview).toHaveBeenCalledWith(90));
  });

  it('KPI deltas are neutral arrows against the previous window', async () => {
    renderAt('/admin/analysis/overview');
    const submissions = (await screen.findByText('Submissions', { selector: 'span' })).parentElement as HTMLElement;
    expect(submissions).toHaveTextContent('▲ 25% vs prev. 30d');
    expect((screen.getByText('Accepted', { selector: 'span' }).parentElement as HTMLElement)).toHaveTextContent('▼ 20% vs prev. 30d');
    expect((screen.getByText('Unique submitters', { selector: 'span' }).parentElement as HTMLElement)).toHaveTextContent('0% vs prev. 30d');
    // Nothing to compare with when the previous window had zero.
    expect((screen.getByText('New users', { selector: 'span' }).parentElement as HTMLElement)).not.toHaveTextContent('vs prev.');
    expect(document.querySelectorAll('[data-tone]').length).toBe(0);
  });

  it('All has no deltas', async () => {
    renderAt('/admin/analysis/overview?range=all');
    await waitFor(() => expect(analyticsService.fetchOverview).toHaveBeenCalledWith(0));
    await screen.findByText('Submissions per day');
    expect(screen.queryByText(/vs prev\./)).toBeNull();
  });

  it('daily bars stack by verdict in verdict colours, and the pie is gone', async () => {
    renderAt('/admin/analysis/overview');
    await screen.findByText('Submissions per day');
    const daily = within(screen.getAllByTestId('bar-chart')[0]).getAllByTestId('bar');
    expect(daily.map((b) => b.dataset.key)).toEqual(DAILY_VERDICT_SERIES.map((s) => s.key));
    expect(new Set(daily.map((b) => b.dataset.stack))).toEqual(new Set(['verdict']));
    expect(daily[0].dataset.fill).toBeTruthy();
    expect(screen.queryByTestId('pie')).toBeNull();
    expect(screen.queryByText('Verdict share')).toBeNull();
  });

  it('Export CSV downloads the table it sits on', async () => {
    renderAt('/admin/analysis/overview');
    await screen.findByText('Top problems');
    fireEvent.click(screen.getByRole('button', { name: 'Export Top problems as CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith('top-problems-30d.csv', [['Problem', 'ID', 'Submissions', 'Accepted'], ['A Plus B', 'aplusb', '30', '20']]);
  });

  it('a selected user lives in the query string', async () => {
    renderAt('/admin/analysis/users?user=5');
    await waitFor(() => expect(analyticsService.fetchUserAnalytics).toHaveBeenCalledWith(5));
    expect(screen.getByRole('tab', { name: 'Users' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('verdict series', () => {
  it('maps each verdict to its token, Accepted first', () => {
    expect(DAILY_VERDICT_SERIES.map((s) => [s.key, s.token])).toEqual([
      ['accepted', '--verdict-accepted'], ['wrong', '--verdict-wrong'], ['time', '--verdict-time'], ['memory', '--verdict-memory'],
      ['runtime', '--verdict-runtime'], ['compilation', '--verdict-compilation'], ['other', '--verdict-pending'],
    ]);
  });
});
