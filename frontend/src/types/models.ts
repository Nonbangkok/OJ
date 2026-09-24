export type UserRole = 'user' | 'staff' | 'admin';

export type ContestStatus = 'scheduled' | 'running' | 'finishing' | 'finished';

export type SubmissionStatus =
  | 'Pending'
  | 'Compiling'
  | 'Running'
  | 'Accepted'
  | 'Wrong Answer'
  | 'Time Limit Exceeded'
  | 'Runtime Error'
  | 'Memory Limit Exceeded'
  | 'Compilation Error'
  | 'Skipped';

export interface AuthUser {
  id: number;
  username: string;
  role: UserRole;
  hasAvatar: boolean;
  /** XP-derived tier label (e.g. "Novice"); present on auth-bootstrap responses. */
  tier?: string;
  /** XP-derived level; present whenever tier is. */
  level?: number;
}

export interface ProblemSuggestion {
  id: string;
  title: string;
}

export interface UserSuggestion {
  id: number;
  username: string;
}

export interface TestCaseResult {
  testCase?: number;
  status: string;
  timeMs?: number;
  memoryKb?: number;
  output?: string;
}

export interface ProblemBase {
  id: string;
  title: string;
  author: string | null;
  /** Fixed-list categories; empty array means uncategorized. */
  categories?: readonly string[];
  /** Codeforces-like rating (800–3500 step 100); null/absent = Unrated. */
  difficulty?: number | null;
}

export interface ContestProblem extends ProblemBase {
  problem_id?: string;
}

export interface ProblemSummary extends ProblemBase {
  best_score?: number | null;
  submission_count?: string | null;
  latest_submission_at?: string | null;
  latest_submission_status?: string | null;
  best_submission_status?: string | null;
  best_submission_results?: TestCaseResult[] | null;
  is_visible?: boolean;
  contest_id?: number | null;
  contest_status?: ContestStatus | null;
}

export interface ProblemDetail extends ProblemBase {
  time_limit_ms: number;
  memory_limit_mb: number;
  has_pdf?: boolean;
  is_visible?: boolean;
}

export interface Contest extends Record<string, unknown> {
  id: number;
  title: string;
  description: string | null;
  start_time: string;
  end_time: string;
  status: ContestStatus;
  created_at?: string;
  created_by?: number | null;
  participant_count?: string;
  created_by_username?: string | null;
  problems?: ProblemBase[];
  is_participant?: boolean;
}

export interface SubmissionSummary {
  id: number;
  username: string;
  problem_id: string;
  problem_title?: string;
  overall_status: string;
  score: number;
  language: string;
  submitted_at: string;
}

export interface SubmissionDetail extends SubmissionSummary {
  code: string;
  max_time_ms: number | null;
  max_memory_kb: number | null;
  results: TestCaseResult[] | string | null;
  problem_name?: string;
}

export interface GlobalScoreboardEntry {
  username: string;
  has_avatar?: boolean;
  total_score: number | string;
  problems_solved: number | string;
  last_score_improvement_time?: string | null;
}

export interface ContestProblemScore {
  score: number;
  attempts: number;
  solved: boolean;
}

export type ContestDetailedScore = Record<string, number | ContestProblemScore>;

export interface ContestScoreboardEntry {
  user_id?: number | string;
  username: string;
  has_avatar?: boolean;
  total_score: number;
  detailed_scores: ContestDetailedScore;
  last_score_improvement_time: string | null;
}

export interface ContestScoreboardPayload {
  scoreboard: ContestScoreboardEntry[];
  problems: ContestProblem[];
}

export interface RegistrationSettings {
  enabled: boolean;
}

/** Public site configuration the frontend loads before rendering. */
export interface SiteConfig {
  accessMode: 'public' | 'private';
  allowRegistration: boolean;
}

export interface AdminUser {
  id: number;
  username: string;
  role: UserRole;
  created_at?: string;
}

export interface BatchCreatedUser {
  username: string;
  password: string;
}

export interface AdminProblem extends ProblemBase {
  /** Organizational collection (at most one); null = No Collection. */
  collection_id: number | null;
  collection_name: string | null;
  is_visible: boolean;
  contest_id: number | null;
  contest_status: ContestStatus | null;
}

export interface UploadProgress {
  status: string;
  message: string;
  processed?: number;
  total?: number;
  currentProblem?: string;
  added?: string[];
  skipped?: string[];
  errors?: Array<{ directory: string; message: string }>;
}

export interface UserProfileDailyActivity {
  day: string;
  count: number;
}

/** An unlocked achievement as returned by the profile endpoint. */
export interface UnlockedAchievement {
  id: string;
  name: string;
  description: string;
}

/** Derivable stats the backend computes for progress display. */
export interface AchievementStats {
  problemsSolved: number;
  currentStreak: number;
  longestStreak: number;
  languagesSolvedIn: Record<string, number>;
  contestsJoined: number;
}

export interface UserProfileResponse {
  id: number;
  username: string;
  role: UserRole;
  hasAvatar: boolean;
  avatarUpdatedAt: string | null;
  createdAt: string;
  problemsAttempted: number;
  problemsSolved: number;
  totalScore: number;
  submissionCount: number;
  verdictCounts: Record<string, number>;
  languageCounts: Record<string, number>;
  dailyActivity: UserProfileDailyActivity[];
  currentStreak: number;
  longestStreak: number;
  lastAcDate: string | null;
  /** Solved/total counts per category, fixed axis order, zero-filled. */
  categoryStats: CategoryStat[];
  achievements: {
    unlocked: UnlockedAchievement[];
    stats: AchievementStats;
  };
  /** XP progression — independent of score; computed by the backend. */
  progression: UserProgression;
  /** Newest-first solve/XP-reward history for the "Recently Solved" list. */
  recentRewards: RecentXpReward[];
}

export interface UserProgression {
  totalXp: number;
  level: number;
  tier: string;
  levelProgress: {
    current: number;
    required: number;
    remaining: number;
    percentage: number;
  };
  /** Dense global rank by total XP; null when the user has no rewards. */
  globalRank: number | null;
}

/** A first-solve XP reward: `awardedAt` is the first-solve timestamp, so a
 *  "Recently Solved" row can be built from it (XP as supporting info). */
export interface RecentXpReward {
  problemId: string;
  problemTitle: string | null;
  xpAwarded: number;
  difficultySnapshot: number | null;
  awardedAt: string;
}

export interface CategoryStat {
  category: string;
  solved: number;
  total: number;
  /** solved/total as a percentage (0 when total is 0); one decimal max. */
  percentage: number;
}

export interface UpdateAvatarResponse {
  message: string;
  avatarUpdatedAt: string;
}
