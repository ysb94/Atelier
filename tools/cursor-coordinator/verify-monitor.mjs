import assert from 'node:assert/strict';

const base = 'http://127.0.0.1:5181';
const response = await fetch(base, { signal: AbortSignal.timeout(5000) });
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /text\/html/u);
assert.equal(response.headers.get('cache-control'), 'no-store');
assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/u);
assert.match(await response.text(), /Cursor 작업 모니터/u);

const api = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(5000) });
assert.equal(api.status, 200);
const state = await api.json();
assert.deepEqual(state.roles.map(role => role.role), ['IMPLEMENT', 'RESEARCH', 'VERIFY', 'REVIEW']);
assert.equal(state.readErrors.length, 0);
for (const role of state.roles) {
  assert.equal(typeof role.resultText, 'string');
  assert.equal(role.modelId, 'composer-2.5');
  if (state.activeLock?.role === role.role) {
    assert.equal(role.status, 'running');
    assert.equal(role.taskId, state.activeLock.taskId);
  }
}
assert.equal((await fetch(`${base}/api/state`, { method: 'POST' })).status, 405);
assert.equal((await fetch(`${base}/auth.json`)).status, 404);
assert.equal((await fetch(`${base}/reports/`)).status, 404);
console.log('PASS: Four role cards, current task ID, read-only API, response headers and error-free state.');
