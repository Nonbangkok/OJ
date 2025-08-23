require('dotenv').config();
const { pool } = require('./db');

const clearSubmissions = async () => {
  console.log('Attempting to clear all submissions...');
  try {
    const result = await pool.query('DELETE FROM submissions;');
    console.log(`Successfully deleted ${result.rowCount} submissions.`);
  } catch (err) {
    console.error('Error clearing submissions:', err);
  } finally {
    await pool.end();
    console.log('Database pool closed.');
  }
};

clearSubmissions(); 