import { migrations } from '../../migrations';
import { authoringJobsDraftTypeIndexSql } from '../../migrations/0028AuthoringJobsDraftTypeIndex';

describe('authoring jobs (draft, type, created) index migration', () => {
  it('is the latest migration', () => {
    expect(migrations[migrations.length - 1].version).toBe('0028_authoring_jobs_draft_type_index');
  });

  it("serves the draft list's newest-job-per-type lookup (B7) without a sort", () => {
    const sql = authoringJobsDraftTypeIndexSql.replace(/\s+/g, ' ').trim();
    expect(sql).toBe(
      'CREATE INDEX IF NOT EXISTS idx_authoring_jobs_draft_type_created ON authoring_jobs(draft_id, job_type, created_at DESC);'
    );
  });
});
