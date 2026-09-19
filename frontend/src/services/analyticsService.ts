import api from './api';

export interface OverviewKpi {
  current: number;
  previous: number;
}

export interface OverviewAnalytics {
  kpis: {
    submissions: OverviewKpi;
    uniqueSubmitters: OverviewKpi;
    accepted: OverviewKpi;
    newUsers: OverviewKpi;
    activeProblems: OverviewKpi;
  };
  dailySeries: Array<{ day: string; total: number; accepted: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  topProblems: Array<{ problemId: string; title: string; submissions: number; accepted: number }>;
  topSubmitters: Array<{ userId: number; username: string; submissions: number; solved: number }>;
  contestStats: Array<{
    contestId: number;
    title: string;
    status: string;
    submissions: number;
    participants: number;
    avgScore: number;
  }>;
}

export type UserSortKey = 'username' | 'submissions' | 'solved' | 'acRate' | 'lastActive';
export type ProblemSortKey = 'title' | 'category' | 'submissions' | 'accepted' | 'acRate' | 'solvers';
export type SortDir = 'asc' | 'desc';

export interface AnalyticsUserRow {
  userId: number;
  username: string;
  role: string;
  submissions: number;
  solved: number;
  acRate: number;
  lastActive: string | null;
}

export interface UserAnalytics {
  user: { id: number; username: string; role: string; createdAt: string };
  kpis: { submissions: number; solved: number; attempted: number; acRate: number; totalScore: number };
  dailySeries: Array<{ day: string; count: number }>;
  hourHistogram: Array<{ hour: number; count: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  languageBreakdown: Array<{ language: string; count: number }>;
  cumulativeSolved: Array<{ day: string; solved: number }>;
  solvedByCategory: Array<{ category: string; solved: number; attempted: number }>;
}

export interface ContestAnalytics {
  contest: { contestId: number; title: string; status: string; startTime: string; endTime: string };
  kpis: { participants: number; submitters: number; submissions: number; accepted: number; avgScore: number; maxScore: number };
  submissionTimeline: Array<{ bucket: string; count: number }>;
  problemStats: Array<{ problemId: string; title: string; submissions: number; accepted: number; acRate: number; solvers: number }>;
  scoreboard: Array<{ username: string; totalScore: number; solved: number }>;
}

export interface ProblemListRow {
  problemId: string;
  title: string;
  category: string | null;
  submissions: number;
  accepted: number;
  acRate: number;
  solvers: number;
}

export interface SubmissionFilters {
  problemId?: string;
  userId?: number;
  verdict?: string;
}

export interface SubmissionListRow {
  id: number;
  source: 'main' | 'contest';
  contestId: number | null;
  problemId: string;
  problemTitle: string;
  userId: number;
  username: string;
  verdict: string;
  score: number;
  language: string;
  timeMs: number | null;
  memoryKb: number | null;
  submittedAt: string;
}

export interface ProblemAnalytics {
  problem: { id: string; title: string };
  kpis: { submissions: number; accepted: number; acRate: number; uniqueSubmitters: number };
  dailySeries: Array<{ day: string; total: number; accepted: number }>;
  verdictBreakdown: Array<{ verdict: string; count: number }>;
  testcasePassRates: Array<{ caseNumber: number; passRate: number }>;
  runtimeBuckets: Array<{ bucket: string; count: number }>;
  memoryBuckets: Array<{ bucket: string; count: number }>;
  firstSolves: Array<{ userId: number; username: string; submittedAt: string }>;
}

export const fetchOverview = async (days = 30): Promise<OverviewAnalytics> => {
  const response = await api.get<OverviewAnalytics>('/analytics/overview', { params: { days } });
  return response.data;
};

export const fetchAnalyticsUsers = async (params: {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: UserSortKey;
  sortDir?: SortDir;
}): Promise<{ users: AnalyticsUserRow[] }> => {
  const response = await api.get<{ users: AnalyticsUserRow[] }>('/analytics/users', { params });
  return response.data;
};

export const fetchAnalyticsProblems = async (params: {
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: ProblemSortKey;
  sortDir?: SortDir;
}): Promise<{ problems: ProblemListRow[] }> => {
  const response = await api.get<{ problems: ProblemListRow[] }>('/analytics/problems', { params });
  return response.data;
};

export const fetchUserAnalytics = async (userId: number): Promise<UserAnalytics> => {
  const response = await api.get<UserAnalytics>(`/analytics/users/${userId}`);
  return response.data;
};

export const fetchProblemAnalytics = async (problemId: string): Promise<ProblemAnalytics> => {
  const response = await api.get<ProblemAnalytics>(`/analytics/problems/${problemId}`);
  return response.data;
};

export const fetchContestAnalytics = async (contestId: number): Promise<ContestAnalytics> => {
  const response = await api.get<ContestAnalytics>(`/analytics/contests/${contestId}`);
  return response.data;
};

export const fetchAnalyticsSubmissions = async (params: {
  problemId?: string;
  userId?: number;
  verdict?: string;
  limit?: number;
  offset?: number;
}): Promise<{ submissions: SubmissionListRow[] }> => {
  const response = await api.get<{ submissions: SubmissionListRow[] }>('/analytics/submissions', { params });
  return response.data;
};
