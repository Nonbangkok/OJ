import { migrations } from '../../migrations';
import { submissionIndexesSql } from '../../migrations/0010SubmissionIndexes';

describe('submission indexes migration', () => {
  it('runs after the profile sync migration', () => {
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
      '0011_authoring_draft_category',
      '0012_problem_categories',
      '0013_problem_difficulty',
      '0014_problem_collections',
      '0015_drop_collection_description',
      '0016_user_problem_rewards',
      '0017_site_access_mode',
      '0018_integrity_fixes',
    ]);
  });

  it('creates covering indexes on both submission pools', () => {
    const sql = submissionIndexesSql.replace(/\s+/g, ' ').trim();

    // submissions (main pool)
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions(user_id)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions(problem_id)');
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at ON submissions(submitted_at DESC)'
    );

    // contest_submissions
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_contest_submissions_user ON contest_submissions(user_id)'
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_contest_submissions_problem ON contest_submissions(problem_id)'
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_contest_submissions_submitted_at ON contest_submissions(submitted_at DESC)'
    );
    expect(sql).toContain(
      'CREATE INDEX IF NOT EXISTS idx_contest_submissions_contest ON contest_submissions(contest_id)'
    );
  });

  it('is purely additive — no destructive statements', () => {
    const sql = submissionIndexesSql.replace(/\s+/g, ' ').trim();

    expect(sql).not.toContain('DROP');
    expect(sql).not.toContain('TRUNCATE');
    expect(sql).not.toContain('DELETE');
    expect(sql).not.toContain('ALTER TABLE');
    expect(sql).not.toContain('CREATE TABLE');
  });
});
