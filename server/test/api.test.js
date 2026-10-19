const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close(error => error ? reject(error) : resolve(port));
    });
  });
}

test('LastPlate API health, registration, authentication and role checks', async t => {
  const testUri = process.env.MONGODB_TEST_URI;
  assert.ok(testUri, 'Set MONGODB_TEST_URI to a dedicated MongoDB test database ending in _test.');
  const databaseName = new URL(testUri).pathname.replace(/^\//, '').split('/')[0];
  assert.ok(databaseName.endsWith('_test'), 'Refusing to run API tests unless the database name ends in _test.');

  const port = await freePort();
  const server = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, PORT: String(port), MONGODB_URI: testUri, JWT_SECRET: 'lastplate-api-test-secret-at-least-32-characters' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  server.stdout.on('data', data => { output += data.toString(); });
  server.stderr.on('data', data => { output += data.toString(); });
  t.after(() => server.kill());

  const base = `http://127.0.0.1:${port}/api`;
  let health;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) assert.fail(`API exited before becoming ready.\n${output}`);
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok && (await response.json()).database === 'connected') { health = response; break; }
    } catch { /* The process is still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(health, `API did not connect to the dedicated test database.\n${output}`);

  const unauthenticated = await fetch(`${base}/favorites`);
  assert.equal(unauthenticated.status, 401);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `api-test-${suffix}@example.invalid`;
  const registration = await fetch(`${base}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'API Test Customer', email, password: 'a-Secure-test-123!', role: 'customer' })
  });
  assert.equal(registration.status, 201);
  const created = await registration.json();
  assert.ok(created.token);
  assert.equal(created.user.role, 'customer');

  const headers = { Authorization: `Bearer ${created.token}` };
  const me = await fetch(`${base}/auth/me`, { headers });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, email);

  const forbidden = await fetch(`${base}/foods`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Not allowed', description: 'role check', category: 'Meals' })
  });
  assert.equal(forbidden.status, 403);

  const providerEmail = `api-provider-${suffix}@example.invalid`;
  const providerRegistration = await fetch(`${base}/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'API Test Provider', email: providerEmail, password: 'a-Secure-test-123!', role: 'provider' })
  });
  assert.equal(providerRegistration.status, 201);
  const provider = await providerRegistration.json();
  assert.equal(provider.user.avatarEmoji, '🥑');
  const avatarUpdate = await fetch(`${base}/auth/me`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${provider.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ avatarEmoji: '🍋' })
  });
  assert.equal(avatarUpdate.status, 200);
  assert.equal((await avatarUpdate.json()).user.avatarEmoji, '🍋');
  const pickupStart = new Date(Date.now() + 60 * 60 * 1000);
  const pickupEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const published = await fetch(`${base}/foods`, {
    method: 'POST', headers: { Authorization: `Bearer ${provider.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Test sourdough', description: 'Fresh test listing', category: 'Bakery',
      originalPrice: 200, price: 100, quantity: 3,
      pickupStart: pickupStart.toISOString(), pickupEnd: pickupEnd.toISOString(),
      address: 'Test kitchen', ingredients: ['flour'], allergens: ['wheat']
    })
  });
  assert.equal(published.status, 201);
  const listing = await published.json();
  assert.equal(listing.item.title, 'Test sourdough');
  assert.equal(listing.item.status, 'pending_approval');
  assert.equal(listing.item.available, 3);

  const providerReservations = await fetch(`${base}/reservations/provider`, {
    headers: { Authorization: `Bearer ${provider.token}` }
  });
  assert.equal(providerReservations.status, 200);
  assert.ok(Array.isArray((await providerReservations.json()).items));

  const listings = await fetch(`${base}/foods`);
  assert.equal(listings.status, 200);
  assert.ok(Array.isArray((await listings.json()).items));
});
