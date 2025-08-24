// This script is intended to be run via `docker-compose exec`.
// Environment variables will be available from the container's environment.
const readline = require('readline');
const bcrypt = require('bcrypt');
const db = require('./db');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to ask questions on the console
const askQuestion = (query) => {
  return new Promise(resolve => rl.question(query, resolve));
}

// Helper to ask for password without showing it
const askPassword = (query) => {
  return new Promise(resolve => {
    const onData = (char) => {
      char = char.toString();
      switch (char) {
        case '\n':
        case '\r':
        case '\u0004':
          process.stdin.removeListener('data', onData);
          break;
        default:
          process.stdout.write('\x1B[2K\x1B[200D' + query + Array(rl.line.length + 1).join('*'));
          break;
      }
    };
    process.stdin.on('data', onData);

    rl.question(query, (password) => {
      resolve(password);
    });
  });
};


async function createAdmin() {
  console.log('--- Create Admin User ---');
  const username = await askQuestion('Enter username for the new admin: ');
  if (!username) {
    console.error('Username cannot be empty.');
    rl.close();
    return;
  }

  // Check if user already exists
  const existingUser = await db.query('SELECT * FROM users WHERE username = $1', [username]);
  if (existingUser.rows.length > 0) {
    console.log(`User "${username}" already exists. Their information will be updated.`);
  }

  const email = await askQuestion(`Enter email for ${username}: `);
  const password = await askPassword(`Enter password for ${username}: `);
  
  if (password.length < 6) {
    console.error('Password must be at least 6 characters long.');
    rl.close();
    return;
  }

  try {
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    await db.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (username) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         role = 'admin';`,
      [username, email, hashedPassword]
    );

    console.log(`Admin user '${username}' created/updated successfully.`);
  } catch (error) {
    console.error('Error creating admin user:', error);
  } finally {
    // Make sure to end the pool connection
  }
}

createAdmin(); 