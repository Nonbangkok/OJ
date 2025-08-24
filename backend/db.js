const { Pool } = require('pg');

// When running in Docker, Docker Compose injects the DATABASE_URL directly.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // When connecting container-to-container on a private Docker network like in this
  // docker-compose setup, SSL is not necessary as the network is isolated.
  // The official Postgres image doesn't enable SSL by default.
  ssl: false,
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
}; 