import { migrations } from '../../migrations';
import { problemAuthoringFoundationSql } from '../../migrations/0002ProblemAuthoringFoundation';
import {
  AUTHORING_DRAFT_STATUSES,
  AUTHORING_JOB_STATUSES,
  AUTHORING_JOB_TYPES,
  DRAFT_TESTCASE_SOURCES,
} from '../../types/authoring';

describe('problem authoring foundation migration', () => {
  it('runs after the existing core schema migration', () => {
    expect(migrations.map((migration) => migration.version)).toEqual([
      '0001_core_schema',
      '0002_problem_authoring_foundation',
      '0003_authoring_job_delivery',
      '0004_authoring_job_inputs',
      '0005_authoring_job_files',
    ]);
  });

  it('creates every authoring table and required uniqueness boundary', () => {
    const sql = problemAuthoringFoundationSql.replace(/\s+/g, ' ').trim();

    for (const table of [
      'author_profiles',
      'problem_drafts',
      'problem_draft_assets',
      'problem_draft_testcases',
      'authoring_jobs',
    ]) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }

    expect(sql).not.toContain('CREATE TABLE IF NOT EXISTS');
    expect(sql).toContain('UNIQUE (draft_id, filename)');
    expect(sql).toContain('UNIQUE (draft_id, case_number)');
    expect(sql).toContain("CHECK (status IN ('draft', 'generated', 'ready', 'published'))");
    expect(sql).toContain("CHECK (source IN ('uploaded', 'generated'))");
  });
});

describe('authoring runtime values', () => {
  it('matches the approved lifecycle and job contract', () => {
    expect(AUTHORING_DRAFT_STATUSES).toEqual(['draft', 'generated', 'ready', 'published']);
    expect(AUTHORING_JOB_STATUSES).toEqual([
      'queued',
      'compiling',
      'running',
      'succeeded',
      'failed',
      'timed_out',
      'cancelled',
      'stale',
    ]);
    expect(AUTHORING_JOB_TYPES).toEqual([
      'compile_solution',
      'compile_generator',
      'run_generator',
      'generate_outputs',
      'build_pdf',
      'verify_all',
    ]);
    expect(DRAFT_TESTCASE_SOURCES).toEqual(['uploaded', 'generated']);
  });
});
