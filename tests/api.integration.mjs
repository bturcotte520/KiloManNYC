import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

// Run only against a disposable local database: this suite purges NYC scores.
const base = process.env.TEST_BASE_URL;
const stationSecret = process.env.TEST_STATION_SECRET;
const adminSecret = process.env.TEST_ADMIN_SECRET;
if (!base || !stationSecret || !adminSecret || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) {
  throw new Error('Set TEST_BASE_URL (localhost only), TEST_STATION_SECRET, and TEST_ADMIN_SECRET for a disposable database.');
}

test('station authorization, persistent rankings, retries, and admin lifecycle', async () => {
  let cookie = '';
  const request = (path, method = 'GET', body, headers = {}) => fetch(`${base}${path}`, {
    method,
    headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const score = { submissionId: randomUUID(), name: 'Brooklyn', score: 900, distance: 123 };
  assert.equal((await request('/api/scores', 'POST', score)).status, 401);
  assert.equal((await request('/api/station', 'POST', { secret: 'wrong' })).status, 401);
  assert.equal((await request('/api/station', 'POST', { secret: stationSecret }, { Origin: 'https://example.com' })).status, 403);
  const login = await request('/api/station', 'POST', { secret: stationSecret });
  assert.equal(login.status, 200);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await (await request('/api/station')).json()).unlocked, true);
  const adminHeaders = { 'x-admin-secret': adminSecret };
  assert.equal((await request('/api/admin/purge', 'POST', {}, adminHeaders)).status, 200);

  assert.equal((await request('/api/scores', 'POST', { ...score, score: 1.5 })).status, 400);
  assert.equal((await request('/api/scores', 'POST', { ...score, score: 2147483648 })).status, 400);
  assert.equal((await request('/api/scores', 'POST', { ...score, name: 'a' })).status, 400);
  assert.equal((await request('/api/scores', 'POST', score, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('/api/scores', 'POST', score)).status, 201);
  assert.equal((await request('/api/scores', 'POST', score)).status, 201);
  assert.equal((await request('/api/scores', 'POST', { ...score, score: 901 })).status, 409);
  assert.equal((await (await request('/api/scores?page=1')).json()).total, 1);

  for (let index = 0; index < 52; index++) {
    assert.equal((await request('/api/scores', 'POST', {
      submissionId: randomUUID(), name: `Queens ${index}`, score: 1000 + index, distance: index,
    })).status, 201);
  }
  const first = await (await request('/api/scores?page=1')).json();
  assert.equal(first.total, 53);
  assert.equal(first.scores.length, 50);
  assert.equal(first.scores[0].rank, 1);
  assert.equal(first.scores[0].score, 1051);
  const second = await (await request('/api/scores?page=2')).json();
  assert.equal(second.scores.length, 3);
  assert.equal(second.scores[0].rank, 51);
  const search = await (await request('/api/scores?page=1&search=BROOK')).json();
  assert.equal(search.total, 1);
  assert.equal(search.scores[0].rank, 53);
  assert.equal((await (await request('/api/scores?page=1&search=%25')).json()).total, 0);
  assert.equal((await (await request('/api/scores')).json()).scores.length, 10);
  assert.match((await request('/api/scores')).headers.get('cache-control'), /no-store/);
  assert.equal((await request('/api/scores?page=-1')).status, 400);
  assert.equal((await request('/api/scores?page=abc')).status, 400);
  assert.equal((await request(`/api/scores/${score.submissionId}`, 'DELETE')).status, 401);
  assert.equal((await request(`/api/scores/${score.submissionId}`, 'DELETE', undefined, adminHeaders)).status, 200);
  assert.equal((await request('/api/scores', 'POST', score)).status, 201);
  assert.equal((await (await request('/api/scores?page=1&search=Brooklyn')).json()).total, 0);
  assert.equal((await request('/api/admin/archive', 'POST', {}, adminHeaders)).status, 200);
  assert.equal((await (await request('/api/scores?page=1')).json()).total, 0);
  assert.equal((await request('/api/admin/purge', 'POST', {}, adminHeaders)).status, 200);
  assert.equal((await request('/api/station', 'DELETE')).status, 200);
  cookie = '';
  assert.equal((await (await request('/api/station')).json()).unlocked, false);
  assert.equal((await request('/api/scores', 'POST', score)).status, 401);
});
