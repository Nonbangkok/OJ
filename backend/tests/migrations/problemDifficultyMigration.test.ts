import { problemDifficultySql } from '../../migrations/0013ProblemDifficulty';

describe('problem difficulty migration', () => {
  it('adds a nullable difficulty column to all three problem tables', () => {
    const sql = problemDifficultySql.replace(/\s+/g, ' ').trim();

    for (const table of ['problems', 'problem_drafts', 'authoring_published_problems']) {
      expect(sql).toContain(`ALTER TABLE ${table} ADD COLUMN difficulty INT`);
    }
    // Nullable: existing rows keep NULL (= Unrated); no backfill.
    expect(sql).not.toContain('difficulty INT NOT NULL');
    expect(sql).not.toContain('UPDATE');
  });

  it('enforces the 800-3500 step-100 scale with a CHECK on every table', () => {
    const sql = problemDifficultySql.replace(/\s+/g, ' ').trim();

    expect(sql.match(/CHECK \(difficulty IS NULL OR \(difficulty BETWEEN 800 AND 3500 AND difficulty % 100 = 0\)\)/g))
      .toHaveLength(3);
  });
});
