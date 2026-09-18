import { Draft, Job } from './types';

// Human-readable names + tones for draft statuses and job types, shared by the
// drafts table, workspace summary, and job history.

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const DRAFT_STATUS: Record<Draft['status'], { label: string; tone: StatusTone; hint: string }> = {
  draft: { label: 'Draft', tone: 'neutral', hint: 'Write the statement and solution, then add testcases.' },
  generated: { label: 'Generated', tone: 'info', hint: 'Testcase outputs exist. Run Verify All to check everything.' },
  ready: { label: 'Ready', tone: 'success', hint: 'Verified at the current revision. Publishing is unlocked.' },
  published: { label: 'Published', tone: 'success', hint: 'Published as a hidden problem. Manage visibility in Problem Management.' },
};

export const draftStatus = (status: Draft['status']) =>
  DRAFT_STATUS[status] ?? { label: status, tone: 'neutral' as const, hint: '' };

const JOB_TYPES: Record<string, string> = {
  compile_solution: 'Compile solution',
  compile_generator: 'Compile generator',
  generate_inputs: 'Generate inputs',
  generate_outputs: 'Generate outputs',
  build_pdf: 'Build PDF',
  verify_all: 'Verify All',
};

export const jobLabel = (jobType: string) => JOB_TYPES[jobType] ?? jobType;

const JOB_STATUSES: Record<string, { label: string; tone: StatusTone }> = {
  queued: { label: 'Queued', tone: 'info' },
  compiling: { label: 'Compiling', tone: 'info' },
  running: { label: 'Running', tone: 'info' },
  succeeded: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

export const jobStatus = (status: string) => JOB_STATUSES[status] ?? { label: status, tone: 'neutral' as const };
