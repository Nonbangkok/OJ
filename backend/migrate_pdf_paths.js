require('dotenv').config();
const { pool, query } = require('./db');

async function migratePdfPaths() {
  console.log('Starting PDF path migration...');
  try {
    // Find all problems that have a pdf path set
    const res = await query("SELECT id, problem_pdf_path FROM problems WHERE problem_pdf_path IS NOT NULL AND problem_pdf_path != ''");
    
    if (res.rows.length === 0) {
      console.log('No problems with PDF paths found to migrate. Exiting.');
      return;
    }

    console.log(`Found ${res.rows.length} problems to migrate.`);
    let updatedCount = 0;

    for (const problem of res.rows) {
      const newPath = `/api/problems/${problem.id}/pdf`;
      if (problem.problem_pdf_path !== newPath) {
        await query(
          'UPDATE problems SET problem_pdf_path = $1 WHERE id = $2',
          [newPath, problem.id]
        );
        console.log(`Updated problem ${problem.id}: '${problem.problem_pdf_path}' -> '${newPath}'`);
        updatedCount++;
      }
    }

    console.log(`Migration complete. ${updatedCount} problem paths were updated.`);

  } catch (err) {
    console.error('Error during migration:', err);
  } finally {
    pool.end();
    console.log('Database pool closed.');
  }
}

migratePdfPaths(); 