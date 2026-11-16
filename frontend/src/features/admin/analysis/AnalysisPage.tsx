import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import OverviewTab from './OverviewTab';
import UsersTab from './UsersTab';
import UserDetail from './UserDetail';
import UserCompare from './UserCompare';
import ProblemsTab from './ProblemsTab';
import ProblemDetail from './ProblemDetail';
import ContestsTab from './ContestsTab';
import ContestDetail from './ContestDetail';
import SubmissionsTab from './SubmissionsTab';
import styles from './AnalysisPage.module.css';
import { PageHeader, SegmentedControl } from '../../../components/ui';

type AnalysisTab = 'overview' | 'users' | 'problems' | 'contests' | 'submissions';

const TABS: Array<{ key: AnalysisTab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'problems', label: 'Problems' },
  { key: 'contests', label: 'Contests' },
  { key: 'submissions', label: 'Submissions' },
];

const RANGES = [
  { value: '7d', label: '7d', days: 7 },
  { value: '30d', label: '30d', days: 30 },
  { value: '90d', label: '90d', days: 90 },
  { value: 'all', label: 'All', days: 0 },
] as const;
const DEFAULT_RANGE = '30d'; // RANGES[1]

const positiveInt = (value: string | null): number | null => {
  const n = Number(value);
  return value !== null && Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Analysis (§7.8). The tab is the route (/admin/analysis/:tab); the overview
 * range and any drill-down (?user, ?compare, ?problem, ?contest) live in the
 * query string, so every view can be linked and survives a reload.
 */
const AnalysisPage = () => {
  const { tab: tabParam } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab: AnalysisTab = TABS.some((t) => t.key === tabParam) ? tabParam as AnalysisTab : 'overview';

  const range = RANGES.find((r) => r.value === params.get('range')) ?? RANGES[1];
  const userId = positiveInt(params.get('user'));
  const compare = (params.get('compare') ?? '').split(',').map((v) => positiveInt(v));
  const compareIds: [number, number] | null = compare.length === 2 && compare[0] !== null && compare[1] !== null
    ? [compare[0], compare[1]] : null;
  const problemId = params.get('problem');
  const contestId = positiveInt(params.get('contest'));

  // Drill-downs replace the query (they belong to the current tab only).
  const show = (next: Record<string, string>) => setParams(next);
  const back = () => setParams({});
  const crossTo = (target: AnalysisTab, next: Record<string, string>) => navigate(`/admin/analysis/${target}?${new URLSearchParams(next)}`);

  const setRange = (value: string) => setParams(value === DEFAULT_RANGE ? {} : { range: value });

  return (
    <div className={styles.container}>
      <PageHeader
        breadcrumb={[{ label: 'Manage' }]}
        title="Analysis"
        actions={tab === 'overview' ? (
          <SegmentedControl aria-label="Time range" options={RANGES.map(({ value, label }) => ({ value, label }))} value={range.value} onChange={setRange} />
        ) : undefined}
        tabs={(
          <div className={styles.tabs} role="tablist" aria-label="Analysis sections">
            {TABS.map(({ key, label }) => (
              <Link
                key={key}
                to={`/admin/analysis/${key}`}
                role="tab"
                aria-selected={tab === key}
                className={tab === key ? styles['tab-active'] : styles.tab}
              >
                {label}
              </Link>
            ))}
          </div>
        )}
      />
      {tab === 'overview' && <OverviewTab days={range.days} rangeKey={range.value} />}
      {tab === 'users' && (
        compareIds !== null
          ? <UserCompare userIds={compareIds} onBack={back} />
          : userId === null
            ? <UsersTab onSelectUser={(id) => show({ user: String(id) })} onCompareUsers={(ids) => show({ compare: ids.join(',') })} />
            : <UserDetail userId={userId} onBack={back} />
      )}
      {tab === 'problems' && (
        problemId === null
          ? <ProblemsTab onSelectProblem={(id) => show({ problem: id })} />
          : <ProblemDetail problemId={problemId} onBack={back} />
      )}
      {tab === 'contests' && (
        contestId === null
          ? <ContestsTab onSelectContest={(id) => show({ contest: String(id) })} />
          : <ContestDetail contestId={contestId} onBack={back} />
      )}
      {tab === 'submissions' && (
        <SubmissionsTab
          onSelectUser={(id) => crossTo('users', { user: String(id) })}
          onSelectProblem={(id) => crossTo('problems', { problem: id })}
        />
      )}
    </div>
  );
};

export default AnalysisPage;
