import assert from 'node:assert/strict';
import { test } from 'node:test';

const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1';

const request = (path, options = {}) => fetch(`${baseUrl}/api${path}`, {
  ...options,
  headers: {
    'Content-Type': 'application/json',
    ...options.headers,
  },
});

test('localhost registration, login, session, and logout work through the proxy', async () => {
  const username = `slice0_${Date.now()}`;
  const password = 'local-test-password';

  const registerResponse = await request('/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert.equal(registerResponse.status, 201, await registerResponse.text());

  const loginResponse = await request('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  assert.equal(loginResponse.status, 200, await loginResponse.text());

  const setCookie = loginResponse.headers.get('set-cookie');
  assert.ok(setCookie, 'login must issue a session cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.doesNotMatch(setCookie, /(?:^|;)\s*Secure(?:;|$)/i);
  assert.doesNotMatch(setCookie, /(?:^|;)\s*Domain=/i);

  const cookie = setCookie.split(';', 1)[0];
  const meResponse = await request('/me', {
    headers: { Cookie: cookie },
  });
  assert.equal(meResponse.status, 200);
  const me = await meResponse.json();
  assert.equal(me.isAuthenticated, true);
  assert.equal(me.user.username, username);

  const logoutResponse = await request('/logout', {
    method: 'POST',
    headers: { Cookie: cookie },
  });
  assert.equal(logoutResponse.status, 200, await logoutResponse.text());

  const afterLogoutResponse = await request('/me', {
    headers: { Cookie: cookie },
  });
  assert.equal(afterLogoutResponse.status, 200);
  assert.deepEqual(await afterLogoutResponse.json(), { isAuthenticated: false });
});
