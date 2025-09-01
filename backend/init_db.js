const db = require('./db');

const dropTables = async () => {
  // Drop in reverse order of creation due to foreign key constraints
  // Using CASCADE to handle dependencies automatically
  
  // Drop Contest tables first
  await db.query('DROP TABLE IF EXISTS contest_scoreboards CASCADE;');
  await db.query('DROP TABLE IF EXISTS contest_problems CASCADE;');
  await db.query('DROP TABLE IF EXISTS contest_submissions CASCADE;');
  await db.query('DROP TABLE IF EXISTS contest_participants CASCADE;');
  await db.query('DROP TABLE IF EXISTS contests CASCADE;');
  
  // Drop main tables
  await db.query('DROP TABLE IF EXISTS submissions CASCADE;');
  await db.query('DROP TABLE IF EXISTS testcases CASCADE;');
  await db.query('DROP TABLE IF EXISTS problems CASCADE;');
  await db.query('DROP TABLE IF EXISTS users CASCADE;');
  await db.query('DROP TABLE IF EXISTS user_sessions CASCADE;');
  await db.query('DROP TABLE IF EXISTS system_settings CASCADE;');
  console.log('Existing tables dropped.');
}

const createTables = async () => {
  const usersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'staff', 'admin')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  const settingsTable = `
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(50) PRIMARY KEY,
      setting_value VARCHAR(255) NOT NULL
    );
  `;

  const sessionTable = `
    CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar NOT NULL COLLATE "default",
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    )
    WITH (OIDS=FALSE);
    ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;
  `;

  const problemsTable = `
    CREATE TABLE problems (
      id VARCHAR(50) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      author VARCHAR(100),
      problem_pdf BYTEA,
      time_limit_ms INT DEFAULT 2000,
      memory_limit_mb INT DEFAULT 256,
      is_visible BOOLEAN NOT NULL DEFAULT false
    );
  `;

  const testcasesTable = `
    CREATE TABLE IF NOT EXISTS testcases (
      id SERIAL PRIMARY KEY,
      problem_id VARCHAR(50) REFERENCES problems(id) ON DELETE CASCADE,
      case_number INT NOT NULL,
      input_data TEXT NOT NULL,
      output_data TEXT NOT NULL,
      UNIQUE (problem_id, case_number)
    );
  `;

  const submissionsTable = `
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      problem_id VARCHAR(50) REFERENCES problems(id) ON DELETE CASCADE ON UPDATE CASCADE,
      code TEXT NOT NULL,
      language VARCHAR(20) NOT NULL,
      overall_status VARCHAR(50) NOT NULL,
      score INT NOT NULL,
      results JSONB,
      max_time_ms INT,
      max_memory_kb INT,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  const contestsTable = `
    CREATE TABLE IF NOT EXISTS contests (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      start_time TIMESTAMPTZ NOT NULL,
      end_time TIMESTAMPTZ NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL
    );
  `;

  const contestParticipantsTable = `
    CREATE TABLE IF NOT EXISTS contest_participants (
      contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (contest_id, user_id)
    );
  `;

  const contestSubmissionsTable = `
    CREATE TABLE IF NOT EXISTS contest_submissions (
      id SERIAL PRIMARY KEY,
      contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      problem_id VARCHAR(50) NOT NULL,
      code TEXT NOT NULL,
      language VARCHAR(20) NOT NULL,
      overall_status VARCHAR(50) NOT NULL,
      score INTEGER NOT NULL,
      results JSONB,
      max_time_ms INTEGER,
      max_memory_kb INTEGER,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  const contestScoreboardsTable = `
    CREATE TABLE IF NOT EXISTS contest_scoreboards (
      contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      total_score INTEGER NOT NULL,
      detailed_scores JSONB,
      PRIMARY KEY (contest_id, user_id)
    );
  `;

  const contestProblemsTable = `
    CREATE TABLE IF NOT EXISTS contest_problems (
      contest_id INTEGER REFERENCES contests(id) ON DELETE CASCADE,
      problem_id VARCHAR(50) NOT NULL,
      title VARCHAR(255) NOT NULL,
      author VARCHAR(100),
      time_limit_ms INT DEFAULT 2000,
      memory_limit_mb INT DEFAULT 256,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (contest_id, problem_id)
    );
  `;

  try {
    await db.query(usersTable);
    await db.query(settingsTable);
    await db.query(sessionTable);
    await db.query(problemsTable);
    await db.query(testcasesTable);
    await db.query(submissionsTable);
    
    // Create Contest tables
    await db.query(contestsTable);
    await db.query(contestParticipantsTable);
    await db.query(contestSubmissionsTable);
    await db.query(contestScoreboardsTable);
    await db.query(contestProblemsTable);
    
    // Set default setting for registration
    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('registration_enabled', 'true')
      ON CONFLICT (setting_key) DO NOTHING;
    `);
    console.log('Tables created successfully!');
    
    // Add contest_id column to problems table AFTER all tables are created
    try {
      await db.query(`
        ALTER TABLE problems 
        ADD COLUMN IF NOT EXISTS contest_id INTEGER REFERENCES contests(id) ON DELETE SET NULL;
      `);
      console.log('Contest_id column added to problems table!');
    } catch (alterErr) {
      console.log('Contest_id column already exists or error:', alterErr.message);
    }
    
    // Create indexes for better performance
    try {
      await db.query('CREATE INDEX IF NOT EXISTS idx_problems_contest_id ON problems(contest_id);');
      await db.query('CREATE INDEX IF NOT EXISTS idx_contest_submissions_contest_user ON contest_submissions(contest_id, user_id);');
      await db.query('CREATE INDEX IF NOT EXISTS idx_contest_participants_contest ON contest_participants(contest_id);');
      await db.query('CREATE INDEX IF NOT EXISTS idx_contests_status ON contests(status);');
      await db.query('CREATE INDEX IF NOT EXISTS idx_contests_time ON contests(start_time, end_time);');
      await db.query('CREATE INDEX IF NOT EXISTS idx_contest_problems_contest ON contest_problems(contest_id);');
      console.log('Database indexes created successfully!');
    } catch (indexErr) {
      console.log('Error creating indexes:', indexErr.message);
    }
  } catch (err) {
    console.error('Error creating tables:', err);
    throw err; // Re-throw to see the error
  }
};

const setupDatabase = async () => {
  try {
    await dropTables();
    await createTables();
  } catch (err) {
    console.error('Error during database setup:', err);
  } finally {
    // In a real app, you might not want to end the pool here
    // but for a setup script, it's fine.
    // Or just let the script exit.
  }
};

setupDatabase(); 