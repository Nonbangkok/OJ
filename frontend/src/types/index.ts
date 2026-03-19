/**
 * Central type definitions for the frontend application
 */

// User and Authentication Types
export interface User {
  id: string | number;
  username: string;
  role: UserRole;
  email?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type UserRole = 'admin' | 'user' | 'judge';

export interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  password: string;
}

export interface AuthResponse {
  isAuthenticated: boolean;
  user?: User;
  message?: string;
}

// Problem Types
export interface Problem {
  id: string | number;
  title: string;
  description: string;
  difficulty?: string;
  timeLimit?: number;
  memoryLimit?: number;
  inputFormat?: string;
  outputFormat?: string;
  constraints?: string;
  sampleInput?: string;
  sampleOutput?: string;
  explanation?: string;
  pdfUrl?: string;
  has_pdf?: boolean;
  isVisible?: boolean;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  submission_count?: number;
  latest_submission_at?: string;
  best_score?: number;
  best_submission_status?: string;
  best_submission_results?: any[];
}

export interface ProblemWithStats extends Problem {
  totalSubmissions: number;
  successfulSubmissions: number;
  successRate: number;
}

export interface TestCase {
  id: string | number;
  input: string;
  expectedOutput: string;
  isSample?: boolean;
  problemId: string | number;
}

// Contest Types
export interface Contest {
  id: string | number;
  name: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  isVisible: boolean;
  isActive: boolean;
  status: 'scheduled' | 'running' | 'finishing' | 'finished' | string;
  is_participant: boolean;
  participant_count?: number;
  problem_count?: number;
  problems?: ContestProblem[];
  participants?: User[];
  createdAt?: string;
  updatedAt?: string;
}

export interface ContestProblem {
  id: string | number;
  contestId: string | number;
  problemId: string | number;
  problem?: Problem;
  order: number;
  maxScore?: number;
}

export interface ContestParticipant {
  id: string | number;
  contestId: string | number;
  userId: string | number;
  user?: User;
  joinedAt: string;
}

// Submission Types
export interface Submission {
  id: string | number;
  userId: string | number;
  user?: User;
  problemId: string | number;
  problem?: Problem;
  problem_name?: string; // Extended field
  problem_title?: string; // Extended field
  contestId?: string | number;
  code: string;
  language: ProgrammingLanguage;
  status: SubmissionStatus;
  submittedAt: string;
  executedAt?: string;
  executionTime?: number;
  memoryUsage?: number;
  score?: number;
  maxScore?: number;
  testCasesPassed?: number;
  totalTestCases?: number;
  errorMessage?: string;
  results?: any; // Detailed results
  username?: string; // Extended field
}

export type ProgrammingLanguage = 'python' | 'java' | 'cpp' | 'c' | 'javascript' | 'typescript';

export type SubmissionStatus = 
  | 'pending'
  | 'compiling'
  | 'running'
  | 'accepted'
  | 'wrong_answer'
  | 'time_limit_exceeded'
  | 'memory_limit_exceeded'
  | 'runtime_error'
  | 'compilation_error'
  | 'internal_error';

export interface CodeSubmission {
  problemId: string | number;
  contestId?: string | number;
  code: string;
  language: ProgrammingLanguage;
}

export interface SubmissionResult {
  success: boolean;
  submission?: Submission;
  message?: string;
  error?: string;
}

// Scoreboard Types
export interface ScoreboardEntry {
  username: string;
  total_score: number;
  problems_solved: number;
  last_score_improvement_time: string;
}

export interface ProblemScore {
  problemId: string | number;
  score: number;
  maxScore: number;
  submissions: number;
  bestSubmission?: Submission;
}

// Contest Scoreboard Types (different structure from global scoreboard)
export interface ContestScoreboardResponse {
  scoreboard: ContestScoreboardEntry[];
  problems: ContestScoreboardProblem[];
}

export interface ContestScoreboardEntry {
  user_id: string | number;
  username: string;
  total_score: number;
  detailed_scores: Record<string | number, { score: number }>;
  last_score_improvement_time: string;
}

export interface ContestScoreboardProblem {
  problem_id: string | number;
  title: string;
}

// Admin Types
export interface AdminSettings {
  registrationEnabled: boolean;
  contestCreationEnabled: boolean;
  systemMaintenance: boolean;
  maintenanceMessage?: string;
}

export interface UserManagementData {
  users: User[];
  totalUsers: number;
  currentPage: number;
  totalPages: number;
}

export interface BatchUserCreation {
  prefix: string;
  count: number;
  defaultPassword?: string;
  role?: UserRole;
}

// UI State Types
export interface LoadingState {
  isLoading: boolean;
  message?: string;
}

export interface ModalState {
  isOpen: boolean;
  data?: any;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  data?: any;
}

export interface ConfirmationModalProps extends ModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  confirmText?: string;
  cancelText?: string;
  confirmStyle?: 'primary' | 'danger';
}

// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T = any> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Theme Types
export type Theme = 'light' | 'dark';

export interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
}

// Settings Types
export interface AppSettings {
  theme: Theme;
  language: string;
  autoSave: boolean;
  fontSize: number;
  tabSize: number;
}

// Form Types
export interface FormField {
  value: string;
  error?: string;
  touched: boolean;
}

export interface FormState<T extends Record<string, any>> {
  fields: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isValid: boolean;
  isSubmitting: boolean;
}

// Error Types
export interface AppError {
  code: string;
  message: string;
  details?: any;
}

export interface ValidationError {
  field: string;
  message: string;
}

// Utility Types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredBy<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
