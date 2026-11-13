// This script is intended to be run via `docker-compose exec`.
// Environment variables will be available from the container's environment.
import bcrypt from 'bcrypt';
import * as db from '../db';
import { SECURITY_CONFIG, USER_ROLES, USER_VALIDATION } from '../constants';
import { createLinePrompter } from './linePrompter';

// Works interactively and with piped input, e.g.
//   printf 'admin\nS3cret-pass\n' | docker compose exec -T backend node dist/scripts/create_admin.js
const prompter = createLinePrompter();

async function createAdmin(): Promise<void> {
  console.log('--- Create Admin User ---');
  const username = ((await prompter.ask('Enter username for the new admin: ')) ?? '').trim();
  if (!username) {
    console.error('Username cannot be empty.');
    process.exitCode = 1;
    return;
  }

  // Check if user already exists
  const existingUser = await db.query('SELECT 1 FROM users WHERE username = $1', [username]);
  if (existingUser.rows.length > 0) {
    console.log(`User "${username}" already exists. Their information will be updated.`);
  }

  const password = (await prompter.askSecret(`Enter password for ${username}: `)) ?? '';
  if (password.length < USER_VALIDATION.MIN_PASSWORD_LENGTH) {
    console.error(`Password must be at least ${USER_VALIDATION.MIN_PASSWORD_LENGTH} characters long.`);
    process.exitCode = 1;
    return;
  }

  const hashedPassword = await bcrypt.hash(password, SECURITY_CONFIG.SALT_ROUNDS);
  await db.query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, '${USER_ROLES.ADMIN}')
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       role = '${USER_ROLES.ADMIN}';`,
    [username, hashedPassword]
  );
  console.log(`Admin user '${username}' created/updated successfully.`);
}

createAdmin()
  .catch((error: unknown) => {
    console.error('Error creating admin user:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    // Always release stdin and the pool, including the early exits above,
    // so the process ends instead of waiting on idle handles.
    prompter.close();
    void db.pool.end();
  });
