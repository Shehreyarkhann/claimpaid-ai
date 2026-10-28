#!/usr/bin/env node
// Tests for POST /api/v1/kb-search (agent Phase 2): the service-to-service
// retrieval endpoint the RCM agent's search_handbook tool calls.
// Verifies: same service-JWT auth as /api/v1/code-assist (good token in,
// bad/missing/wrong-service tokens 401), retrieval is scoped to the
// 'payer-policy-handbook' KB ONLY (a second KB's content never leaks),
// chunks come back as [{ text, source, score }] with the source filename,
// and a body without a query is a 400.
// Usage: node kb-search-test.cjs
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = '/home/hatch/workspace/portfolio/askbase';
const DB = '/tmp/askbase-kbsearch-test.db';
const PORT = 4106;
const API = `http://127.0.0.1:${PORT}`;
const RCM_SECRET = 'rcm-test-secret';

try { fs.unlinkSync(DB); } catch {}
try { fs.unlinkSync(DB + '-wal'); } catch {}
try { fs.unlinkSync(DB + '-shm'); } catch {}

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, p, { token, body, form, headers } = {}) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + p, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

function boot(extraEnv = {}) {
  const server = spawn('node', [path.join(REPO, 'server/src/index.js')], {
    env: { ...process.env, ASKBASE_DB_PATH: DB, PORT: String(PORT), JWT_SECRET: 'test-secret', RCM_JWT_SECRET: RCM_SECRET, LLM_PROVIDER: 'demo', ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d.toString(); });
  server.stderr.on('data', (d) => { log += d.toString(); });
  return { server, log: () => log };
}
async function waitUp() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(API + '/api/health'); if (r.ok) return true; } catch {}
    try { const r = await fetch(API + '/'); if (r.ok) return true; } catch {}
    await sleep(250);
  }
  return false;
}
const kill = (server) => new Promise((res) => { server.on('exit', res); server.kill('SIGTERM'); setTimeout(res, 2000); });

async function waitDocReady(token, kbId) {
  for (let i = 0; i < 240; i++) {
    const d = await req('GET', `/api/kb/${kbId}/documents`, { token });
    const docs = d.json.documents || d.json || [];
    if (Array.isArray(docs) && docs.some((x) => x.status === 'ready')) return true;
    await sleep(1000);
  }
  return false;
}

(async () => {
  let { server, log } = boot();
  try {
    ok('server boots', await waitUp(), log().slice(-400));

    let r = await req('POST', '/api/auth/signup', { body: { orgName: 'KB Search Test Org', name: 'Owner', email: 'owner@kbsearch.io', password: 'TestPass123!' } });
    ok('signup', [200, 201].includes(r.status) && !!r.json.token, `status=${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    const token = r.json.token;

    // Handbook candidate KB (Aetna content) + a second KB that must NEVER
    // be searched by kb-search (Cigna content).
    r = await req('POST', '/api/kb', { token, body: { name: 'Payer Policy Handbook', description: 'handbook' } });
    ok('handbook KB created', !!r.json.kb?.id, JSON.stringify(r.json).slice(0, 200));
    const kb1 = r.json.kb.id;
    r = await req('POST', '/api/kb', { token, body: { name: 'Other KB', description: 'not the handbook' } });
    ok('second KB created', !!r.json.kb?.id, JSON.stringify(r.json).slice(0, 200));
    const kb2 = r.json.kb.id;

    const fd1 = new FormData();
    fd1.append('files', new Blob(['Aetna timely filing rules: claims must be submitted within 120 days of the date of service. Appeals must be filed within 60 days of the denial date.'], { type: 'text/plain' }), 'aetna.txt');
    r = await req('POST', `/api/kb/${kb1}/documents/upload`, { token, form: fd1 });
    ok('handbook document uploaded', r.status === 200 || r.status === 201, `status=${r.status} ${r.text.slice(0, 200)}`);
    const fd2 = new FormData();
    fd2.append('files', new Blob(['Cigna timely filing rules: claims must be submitted within 180 days of the date of service.'], { type: 'text/plain' }), 'cigna.txt');
    r = await req('POST', `/api/kb/${kb2}/documents/upload`, { token, form: fd2 });
    ok('second-KB document uploaded', r.status === 200 || r.status === 201, `status=${r.status} ${r.text.slice(0, 200)}`);

    ok('handbook document ready (embeddings done)', await waitDocReady(token, kb1));
    ok('second-KB document ready', await waitDocReady(token, kb2));

    await kill(server);

    // Mark KB1 as THE handbook (the public slug the endpoint looks up).
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(DB);
    raw.prepare("UPDATE knowledge_bases SET public_slug = 'payer-policy-handbook' WHERE id = ?").run(kb1);
    raw.close();

    ({ server, log } = boot());
    ok('server reboots with handbook slug set', await waitUp(), log().slice(-300));

    const jwt = require(path.join(REPO, 'server/node_modules/jsonwebtoken'));
    const goodToken = jwt.sign({ service: 'claimpaid-rcm', org: 4242 }, RCM_SECRET);
    const wrongSecret = jwt.sign({ service: 'claimpaid-rcm', org: 4242 }, 'not-the-secret');
    const wrongService = jwt.sign({ service: 'something-else', org: 4242 }, RCM_SECRET);

    r = await req('POST', '/api/v1/kb-search', { headers: { 'x-service-token': goodToken }, body: { query: 'What is the Aetna timely filing deadline?' } });
    ok('kb-search 200 with a valid service token', r.status === 200, `status=${r.status} ${r.text.slice(0, 200)}`);
    const chunks = (r.json && r.json.chunks) || [];
    ok('kb-search returns chunks', chunks.length >= 1, JSON.stringify(r.json).slice(0, 200));
    ok('chunk shape is {text, source, score}', chunks.length >= 1 && typeof chunks[0].text === 'string' && typeof chunks[0].source === 'string' && typeof chunks[0].score === 'number', JSON.stringify(chunks[0] || {}).slice(0, 150));
    ok('chunk carries the handbook fact (120 days)', chunks.some((c) => /120/.test(c.text)), JSON.stringify(chunks).slice(0, 250));
    ok('every chunk is sourced from the handbook document', chunks.every((c) => c.source === 'aetna.txt'), JSON.stringify(chunks.map((c) => c.source)));
    ok("second KB's content never leaks (no 180-day chunk)", chunks.every((c) => !/180/.test(c.text)), JSON.stringify(chunks).slice(0, 250));

    r = await req('POST', '/api/v1/kb-search', { headers: { 'x-service-token': wrongSecret }, body: { query: 'Aetna timely filing' } });
    ok('wrong-secret token rejected (401)', r.status === 401, `status=${r.status}`);
    r = await req('POST', '/api/v1/kb-search', { headers: { 'x-service-token': wrongService }, body: { query: 'Aetna timely filing' } });
    ok('wrong-service token rejected (401)', r.status === 401, `status=${r.status}`);
    r = await req('POST', '/api/v1/kb-search', { body: { query: 'Aetna timely filing' } });
    ok('missing token rejected (401)', r.status === 401, `status=${r.status}`);
    r = await req('POST', '/api/v1/kb-search', { headers: { 'x-service-token': goodToken }, body: {} });
    ok('missing query is a 400', r.status === 400, `status=${r.status}`);
  } catch (e) {
    fail++;
    console.log(`FAIL — suite error: ${e.message}`);
  } finally {
    await kill(server);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
