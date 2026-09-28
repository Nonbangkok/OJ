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
});
