const assert = require('node:assert/strict');
const { classifyRetry } = require('./lib/classify-retry');
const { sessionCookie } = require('./lib/session-cookie');

const retried = classifyRetry(
  { name: 'hire', status: 'timedOut', duration_ms: 1000 },
  { name: 'hire', status: 'failed', duration_ms: 20 },
);
assert.equal(retried.status, 'failed');

const cookie = sessionCookie('session-value', 'http://127.0.0.1:18080');
assert.equal(cookie.sameSite, 'Lax');

console.log('inspector checks passed');
