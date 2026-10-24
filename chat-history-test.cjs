#!/usr/bin/env node
// Tests for deploy #41 AI chat work: widget visitor history (list / switch /
// resume), the 24-hour history window on both the public widget and the
// logged-in chat, and the web-fallback fall-through (a failed web search
// must still end in a completed answer, never a hang).
// Usage: node chat-history-test.cjs
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO = '/home/hatch/workspace/portfolio/askbase';
const DB = '/tmp/askbase-history-test.db';
const PORT = 4105;
const API = `http://127.0.0.1:${PORT}`;

try { fs.unlinkSync(DB); } catch {}

let pass = 0, fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log(`PASS — ${name}`); }
  else { fail++; console.log(`FAIL — ${name} ${extra}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, p, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(API + p, { method, headers, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text };
}

// POST an SSE chat endpoint and collect the event stream.
async function chat(p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(API + p, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  const events = [];
  for (const block of text.split('\n\n')) {
    const type = (block.match(/event: (.+)/) || [])[1];
    const dataRaw = (block.match(/data: (.+)/) || [])[1];
    if (!type) continue;
    let data = {};
    try { data = JSON.parse(dataRaw); } catch {}
    events.push({ type, data });
  }
  const content = events.filter((e) => e.type === 'token').map((e) => e.data.text || '').join('');
  const convoId = (events.find((e) => e.type === 'convo') || {}).data?.conversation_id;
  const done = events.some((e) => e.type === 'done');
  const mode = (events.find((e) => e.type === 'done') || {}).data?.mode;
  return { status: r.status, events, content, convoId, done, mode };
}

function boot(extraEnv = {}) {
  const server = spawn('node', [path.join(REPO, 'server/src/index.js')], {
    env: { ...process.env, ASKBASE_DB_PATH: DB, PORT: String(PORT), JWT_SECRET: 'test-secret', LLM_PROVIDER: 'demo', ...extraEnv },
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

(async () => {
  let { server, log } = boot();
  try {
    ok('server boots', await waitUp(), log().slice(-400));

    let r = await req('POST', '/api/auth/signup', { body: { orgName: 'History Test Org', name: 'Owner', email: 'owner@hist.io', password: 'TestPass123!' } });
    ok('signup', [200, 201].includes(r.status) && !!r.json.token, `status=${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    const token = r.json.token;

    r = await req('POST', '/api/kb', { token, body: { name: 'Test KB', description: 'test' } });
    ok('KB created', !!r.json.kb?.id, JSON.stringify(r.json).slice(0, 200));
    const kb = r.json.kb;
    const slug = kb.public_slug;

    r = await req('PUT', `/api/kb/${kb.id}`, { token, body: { public_enabled: true } });
    ok('KB made public', r.json.kb?.public_enabled === 1, JSON.stringify(r.json.kb || {}).slice(0, 150));

    const fd = new FormData();
    fd.append('files', new Blob(['Aetna timely filing rules: claims must be submitted within 120 days of the date of service. Appeals must be filed within 60 days of the denial date.'], { type: 'text/plain' }), 'aetna.txt');
    r = await req('POST', `/api/kb/${kb.id}/documents/upload`, { token, form: fd });
    ok('document uploaded', r.status === 200 || r.status === 201, `status=${r.status} ${r.text.slice(0, 200)}`);

    let ready = false;
    for (let i = 0; i < 240 && !ready; i++) {
      const d = await req('GET', `/api/kb/${kb.id}/documents`, { token });
      const docs = d.json.documents || d.json || [];
      ready = Array.isArray(docs) && docs.some((x) => x.status === 'ready');
      if (!ready) await sleep(1000);
    }
    ok('document ready (embeddings done)', ready);

    // --- logged-in chat + history ---
    let c = await chat(`/api/kb/${kb.id}/chat`, { message: 'What is the Aetna timely filing deadline?' }, token);
    ok('auth chat completes with done event', c.status === 200 && c.done, `status=${c.status} done=${c.done}`);
    ok('auth chat answer cites the doc (120 days)', /120/.test(c.content), c.content.slice(0, 150));
    const authConvoId = c.convoId;
    ok('auth chat returns conversation id', !!authConvoId);

    r = await req('GET', `/api/kb/${kb.id}/chat/conversations`, { token });
    ok('auth history lists the conversation', r.json.conversations?.length === 1 && r.json.conversations[0].id === authConvoId,
      JSON.stringify(r.json.conversations || []).slice(0, 200));

    // --- widget (public) chat + visitor history ---
    const V1 = 'visitor-test-0001';
    const V2 = 'visitor-test-0002';
    c = await chat(`/api/share/kb/${slug}/chat`, { message: 'What is the Aetna timely filing deadline?', visitor_id: V1 });
    ok('widget chat completes', c.status === 200 && c.done && /120/.test(c.content), `status=${c.status} ${c.content.slice(0, 120)}`);
    const s1 = c.convoId;
    ok('widget chat returns conversation id', !!s1);

    c = await chat(`/api/share/kb/${slug}/chat`, { message: 'And the appeal window?', conversation_id: s1, visitor_id: V1 });
    ok('widget follow-up resumes same conversation', c.convoId === s1, `got ${c.convoId} want ${s1}`);

    r = await req('GET', `/api/share/kb/${slug}/conversations?visitor_id=${V1}`);
    ok('widget history lists visitor convo (4 messages)', r.json.conversations?.length === 1 && r.json.conversations[0].msg_count === 4,
      JSON.stringify(r.json.conversations || []).slice(0, 200));
    r = await req('GET', `/api/share/kb/${slug}/conversations?visitor_id=${V2}`);
    ok('other visitor sees no history', r.json.conversations?.length === 0, JSON.stringify(r.json).slice(0, 150));

    r = await req('GET', `/api/share/kb/${slug}/conversations/${s1}?visitor_id=${V1}`);
    ok('widget opens own conversation with messages', r.status === 200 && r.json.conversation?.messages?.length === 4,
      `status=${r.status} msgs=${r.json.conversation?.messages?.length}`);
    r = await req('GET', `/api/share/kb/${slug}/conversations/${s1}?visitor_id=${V2}`);
    ok('other visitor cannot open the conversation (404)', r.status === 404, `status=${r.status}`);

    c = await chat(`/api/share/kb/${slug}/chat`, { message: 'hijack attempt', conversation_id: s1, visitor_id: V2 });
    ok('visitor cannot resume someone else\'s conversation', c.convoId && c.convoId !== s1, `got ${c.convoId}`);

    await kill(server);

    // --- backdate everything 25h: the 24h window must hide it all ---
    const { DatabaseSync } = require('node:sqlite');
    const raw = new DatabaseSync(DB);
    raw.prepare(`UPDATE conversations SET created_at = datetime('now', '-25 hours')`).run();
    raw.close();

    ({ server, log } = boot({ BRAVE_API_KEY: 'dummy-invalid-key-for-test' }));
    ok('server reboots', await waitUp(), log().slice(-300));

    r = await req('GET', `/api/share/kb/${slug}/conversations?visitor_id=${V1}`);
    ok('widget history empty after 24h', r.json.conversations?.length === 0, JSON.stringify(r.json).slice(0, 150));
    r = await req('GET', `/api/share/kb/${slug}/conversations/${s1}?visitor_id=${V1}`);
    ok('old widget conversation cannot be opened (404)', r.status === 404, `status=${r.status}`);
    r = await req('GET', `/api/kb/${kb.id}/chat/conversations`, { token });
    ok('auth history empty after 24h', r.json.conversations?.length === 0, JSON.stringify(r.json).slice(0, 150));

    c = await chat(`/api/share/kb/${slug}/chat`, { message: 'fresh start please', conversation_id: s1, visitor_id: V1 });
    ok('resuming an expired conversation starts a new one', c.convoId && c.convoId !== s1, `got ${c.convoId}`);

    // --- web fallback fall-through: enabled + bad key => still answers ---
    r = await req('PUT', `/api/kb/${kb.id}`, { token, body: { web_fallback: true } });
    ok('web fallback enabled on KB', r.json.kb?.web_fallback === 1, JSON.stringify(r.json.kb || {}).slice(0, 150));
    const t0 = Date.now();
    c = await chat(`/api/share/kb/${slug}/chat`, { message: 'Who won the FIFA World Cup in 1998?', visitor_id: V1 });
    const elapsed = Date.now() - t0;
    ok('off-topic question still completes (no hang)', c.done && c.content.length > 0, `done=${c.done} len=${c.content.length} mode=${c.mode}`);
    ok('off-topic question answered within 60s', elapsed < 60000, `${elapsed}ms`);

    console.log(`\n${pass} passed, ${fail} failed`);
    if (fail) console.log('\n--- server log tail ---\n' + log().slice(-1200));
  } finally {
    await kill(server);
  }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
