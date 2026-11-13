import { serializeProblemConfig } from '../../services/problemConfigSerializer';

describe('serializeProblemConfig', () => {
  const base = {
    id: 'amgis',
    title: 'AMGIS',
    author: 'Nonbangkok',
    time_limit_ms: 1000,
    memory_limit_mb: 256,
    categories: ['Geometry', 'Implementation'] as const,
    difficulty: 800,
    collection_name: 'CEDT',
    problem_pdf: null,
    problem_type: 'standard' as const,
    submission_filename: null,
  };

  it('serializes canonical category names, numeric difficulty, and collection name', () => {
    expect(serializeProblemConfig(base)).toEqual({
      id: 'amgis',
      title: 'AMGIS',
      author: 'Nonbangkok',
      time_limit_ms: 1000,
      memory_limit_mb: 256,
      categories: ['Geometry', 'Implementation'],
      difficulty: 800,
      collection: 'CEDT',
    });
  });

  it('uses portable empty/null metadata types and excludes internal fields', () => {
    const config = serializeProblemConfig({
      ...base,
      categories: [] as const,
      difficulty: null,
      collection_name: null,
    });
    expect(config.categories).toEqual([]);
    expect(config.difficulty).toBeNull();
    expect(config.collection).toBeNull();
    expect(JSON.parse(JSON.stringify(config))).toEqual({
      id: 'amgis',
      title: 'AMGIS',
      author: 'Nonbangkok',
      time_limit_ms: 1000,
      memory_limit_mb: 256,
      categories: [],
      difficulty: null,
      collection: null,
    });
    expect(config).not.toHaveProperty('problem_pdf');
    expect(config).not.toHaveProperty('collection_id');
  });

  it('emits problem_type and submission_filename only for header problems', () => {
    const header = serializeProblemConfig({
      ...base, problem_type: 'header', submission_filename: 'student.h',
    });
    expect(header).toMatchObject({ problem_type: 'header', submission_filename: 'student.h' });

    const standard = serializeProblemConfig({
      ...base, problem_type: 'standard', submission_filename: null,
    });
    expect(standard).not.toHaveProperty('problem_type');
    expect(standard).not.toHaveProperty('submission_filename');
    expect(JSON.parse(JSON.stringify(serializeProblemConfig(base)))).not.toHaveProperty('problem_type');
  });
});
