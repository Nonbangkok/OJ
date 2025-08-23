const db = require('./db');

const seedProblems = async () => {
  console.log('Seeding problems...');
  
  const problemsToSeed = [
    {
      id: 'sum',
      title: 'Sum of Two Numbers',
      description: 'Given two integers, print their sum.',
      pdfPath: 'problems/sum.pdf',
      timeLimit: 1000,
      memoryLimit: 128
    },
    {
      id: 'even-odd',
      title: 'Even or Odd',
      description: 'Given an integer, print "Even" if it is even, and "Odd" if it is odd.',
      pdfPath: 'problems/even-odd.pdf',
      timeLimit: 1000,
      memoryLimit: 128
    },
    {
      id: 'simple-loop',
      title: 'Simple Loop',
      description: 'Given an integer N, print the word "Hello" N times, each on a new line.',
      pdfPath: 'problems/simple-loop.pdf',
      timeLimit: 1000,
      memoryLimit: 128
    }
  ];

  try {
    for (const problem of problemsToSeed) {
      const query = `
        INSERT INTO problems (id, title, description, problem_pdf_path, time_limit_ms, memory_limit_mb)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          problem_pdf_path = EXCLUDED.problem_pdf_path,
          time_limit_ms = EXCLUDED.time_limit_ms,
          memory_limit_mb = EXCLUDED.memory_limit_mb;
      `;
      await db.query(query, [problem.id, problem.title, problem.description, problem.pdfPath, problem.timeLimit, problem.memoryLimit]);
    }
    console.log('Successfully seeded problems!');
  } catch (err) {
    console.error('Error seeding problems:', err);
  }
};

seedProblems(); 