import { migrations } from '../../migrations';
import { problemAuthoringFoundationSql } from '../../migrations/0002ProblemAuthoringFoundation';
import { authoringPublishedProblemProvenanceSql } from '../../migrations/0006AuthoringPublishedProblemProvenance';
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
      '0006_authoring_published_problem_provenance',
      '0007_problem_category',
      '0008_user_profile',
      '0009_profile_sync',
      '0010_submission_indexes',
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

  it('records the immutable legacy publication binding for revision updates', () => {
    const sql = authoringPublishedProblemProvenanceSql.replace(/\s+/g, ' ').trim();

    expect(sql).toContain('CREATE TABLE authoring_published_problems');
    expect(sql).toContain('draft_id UUID PRIMARY KEY REFERENCES problem_drafts(id) ON DELETE CASCADE');
    expect(sql).toContain('problem_id VARCHAR(50) NOT NULL');
    expect(sql).toContain('JOIN problems p ON p.id=d.problem_id');
    expect(sql).toContain('WHERE d.published_at IS NOT NULL');
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
      'sync_pdf',
    ]);
    expect(DRAFT_TESTCASE_SOURCES).toEqual(['uploaded', 'generated']);
  });
});
