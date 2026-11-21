const fs = require('fs');

const base = process.env.BASE_URL;
const state = JSON.parse(fs.readFileSync(process.env.STATE_PATH, 'utf8'));
const password = process.env.ARIA_E2E_PASSWORD;
if (!password) {
  throw new Error('ARIA_E2E_PASSWORD is not set');
}

function keyFor(name) {
  return fs.readFileSync(`${process.env.SECRET_DIR}/${name}`, 'utf8').trim();
}

async function authenticate(login) {
  const response = await fetch(`${base}/web/session/authenticate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: 1,
      params: { db: state.db, login, password },
    }),
  });
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  const joined = cookies.join(';');
  const match = joined.match(/session_id=([^;]+)/);
  if (!response.ok || !match) {
    throw new Error(`authentication failed for ${login}`);
  }
  return match[1];
}

async function callKw(session, model, method, args, kwargs = {}) {
  const response = await fetch(`${base}/web/dataset/call_kw/${model}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `session_id=${session}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      id: 1,
      params: { model, method, args, kwargs },
    }),
  });
  const payload = await response.json();
  if (payload.error) {
    const message = payload.error.data?.message || payload.error.message || 'rpc error';
    return { ok: false, message: String(message) };
  }
  return { ok: true, result: payload.result };
}

async function json2(user, model, method, body) {
  const response = await fetch(`${base}/json/2/${model}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${keyFor(user)}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    parsed = null;
  }
  if (!response.ok) {
    const message = parsed?.message || parsed?.error || text.slice(0, 400);
    return { ok: false, status: response.status, message: String(message) };
  }
  return { ok: true, result: parsed };
}

function pdfBase64() {
  return fs.readFileSync(process.env.CONTRACT_PDF).toString('base64');
}

module.exports = { state, authenticate, callKw, json2, pdfBase64 };
