import { migrations } from '../../migrations';
import { userProfileSql } from '../../migrations/0008UserProfile';

describe('user profile migration', () => {
  it('runs after the problem category migration', () => {
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

  it('adds the avatar columns to users without touching existing structure', () => {
    const sql = userProfileSql.replace(/\s+/g, ' ').trim();

    expect(sql).toContain(
      'ALTER TABLE users ADD COLUMN avatar_png BYTEA'
    );
    expect(sql).toContain(
      'ALTER TABLE users ADD COLUMN avatar_updated_at TIMESTAMPTZ'
    );
    expect(sql).not.toContain('CREATE TABLE');
    expect(sql).not.toContain('DROP');
  });
});
