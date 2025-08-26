const db = require('./db');

const dropTables = async () => {
  // Drop in reverse order of creation due to foreign key constraints
  // Using CASCADE to handle dependencies automatically
  await db.query('DROP TABLE IF EXISTS submissions;');
  await db.query('DROP TABLE IF EXISTS testcases;'); // Add this
  await db.query('DROP TABLE IF EXISTS problems CASCADE;');
  await db.query('DROP TABLE IF EXISTS users CASCADE;');
  await db.query('DROP TABLE IF EXISTS user_sessions CASCADE;');
  await db.query('DROP TABLE IF EXISTS system_settings;');
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
      memory_limit_mb INT DEFAULT 256
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

  try {
    await db.query(usersTable);
    await db.query(settingsTable);
    await db.query(sessionTable);
    await db.query(problemsTable);
    await db.query(testcasesTable); // Add this
    await db.query(submissionsTable);
    // Set default setting for registration
    await db.query(`
      INSERT INTO system_settings (setting_key, setting_value)
      VALUES ('registration_enabled', 'true')
      ON CONFLICT (setting_key) DO NOTHING;
    `);
    console.log('Tables created successfully!');
  } catch (err) {
    console.error('Error creating tables:', err);
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