import { ProblemCategory } from '../constants';

export const AUTHORING_DRAFT_STATUSES = ['draft', 'generated', 'ready', 'published'] as const;
export type AuthoringDraftStatus = typeof AUTHORING_DRAFT_STATUSES[number];

export const AUTHORING_JOB_STATUSES = [
  'queued',
  'compiling',
  'running',
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
  'stale',
] as const;
export type AuthoringJobStatus = typeof AUTHORING_JOB_STATUSES[number];

export const AUTHORING_JOB_TYPES = [
  'compile_solution',
  'compile_generator',
  'run_generator',
  'generate_outputs',
  'build_pdf',
  'verify_all',
  'sync_pdf',
] as const;
export type AuthoringJobType = typeof AUTHORING_JOB_TYPES[number];

export const AUTHORING_PROFILE_SYNC_STATUSES = ['queued', 'running', 'succeeded', 'failed'] as const;
export type AuthoringProfileSyncStatus = typeof AUTHORING_PROFILE_SYNC_STATUSES[number];

export const AUTHORING_PROFILE_SYNC_ITEM_STATUSES = ['pending', 'syncing', 'synced', 'failed', 'deferred'] as const;
export type AuthoringProfileSyncItemStatus = typeof AUTHORING_PROFILE_SYNC_ITEM_STATUSES[number];

export interface AuthoringProfileSyncRow {
  id: string;
  profile_id: string;
  status: AuthoringProfileSyncStatus;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface AuthoringProfileSyncItemRow {
  id: string;
  sync_id: string;
  draft_id: string;
  status: AuthoringProfileSyncItemStatus;
  attempts: number;
  next_attempt_at: Date | null;
  sync_revision: number | null;
  sync_pdf_job_id: string | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
}

export const DRAFT_TESTCASE_SOURCES = ['uploaded', 'generated'] as const;
export type DraftTestcaseSource = typeof DRAFT_TESTCASE_SOURCES[number];

export interface AuthorProfileRow {
  id: string;
  user_id: number | null;
  aka_name: string;
  real_name: string;
  default_language: string;
  country_code: string;
  profile_image_png: Buffer | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProblemDraftRow {
  id: string;
  problem_id: string;
  title: string;
  author_profile_id: string | null;
  author_aka_name: string;
  author_real_name: string;
  language: string;
  country_code: string;
  author_profile_image_png: Buffer | null;
  categories: readonly ProblemCategory[];
  difficulty: number | null;
  time_limit_ms: number;
  memory_limit_mb: number;
  statement_html: string;
  solution_cpp: string;
  generator_cpp: string | null;
  latest_pdf: Buffer | null;
  latest_pdf_revision: number | null;
  template_version: string;
  revision: number;
  verified_revision: number | null;
  status: AuthoringDraftStatus;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  published_at: Date | null;
}

export interface ProblemDraftAssetRow {
  id: string;
  draft_id: string;
  filename: string;
  mime_type: string;
  content: Buffer;
  checksum_sha256: string;
  size_bytes: string;
  created_at: Date;
  updated_at: Date;
}

export interface ProblemDraftTestcaseRow {
  id: string;
  draft_id: string;
  case_number: number;
  original_input_filename: string;
  input_data: string;
  output_data: string | null;
  source: DraftTestcaseSource;
  source_revision: number;
  created_at: Date;
  updated_at: Date;
}

export interface AuthoringJobRow {
  id: string;
  draft_id: string;
  job_type: AuthoringJobType;
  draft_revision: number;
  status: AuthoringJobStatus;
  result_summary: Record<string, unknown> | null;
  log: string;
  error_code: string | null;
  error_message: string | null;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}
