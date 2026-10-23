require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { initSchema } = require('./db');

const app = express();
initSchema();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/kb', require('./routes/kb'));
app.use('/api/kb/:kbId/documents', require('./routes/documents'));
app.use('/api/kb/:kbId/chat', require('./routes/chat'));
app.use('/api/kb/:kbId/analytics', require('./routes/analytics'));
app.use('/api/kb/:kbId/sources', require('./routes/sources'));
app.use('/api/kb/:kbId/autopilot', require('./routes/autopilot'));
app.use('/api/keys', require('./routes/apikeys'));
app.use('/api/v1', require('./routes/apikeys').v1);
app.use('/api/v1', require('./routes/codeassist'));
app.use('/api/share', require('./routes/share'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// seed on first boot (creates demo org if SEED_DEMO=true and no users exist)
if (process.env.SEED_DEMO === 'true') {
  try { require('./seed')(); } catch (e) { console.log('seed skipped:', e.message); }
}

// static: landing at /, app at /app
const landingDir = path.join(__dirname, '..', '..', 'landing');
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(landingDir)) {
  app.use(express.static(landingDir));
}
if (fs.existsSync(clientDist)) {
  app.use('/app', express.static(clientDist));
  // SPA fallback for /app/* (incl. /app/widget/:slug)
  app.get(/^\/app\/.*/, (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 4001;
app.listen(PORT, () => {
  console.log(`AskBase listening on :${PORT} (landing /, app /app)`);
});

// --- LLM warmup: preload the model into memory so the first user query isn't a cold start ---
setTimeout(() => {
  try {
    const { llmEnabled, LLM_BASE, LLM_MODEL } = require('./rag');
    if (!llmEnabled() || !LLM_BASE.includes('11434')) return;
    fetch(`${LLM_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: LLM_MODEL, prompt: 'hi', stream: false, options: { num_predict: 1 } }),
      signal: AbortSignal.timeout(120000),
    }).then(() => console.log('[warmup] LLM model preloaded')).catch((e) => console.log('[warmup] skipped:', e.message));
  } catch (e) { console.log('[warmup] skipped:', e.message); }
}, 15000);

// --- Autopilot: re-crawl all sources once a day, learn without human input ---
const { db: cronDb } = require('./db');
const { runSource } = require('./crawler');
async function autopilotTick() {
  try {
    const sources = cronDb.prepare(`
      SELECT s.* FROM sources s
      WHERE s.last_run_at IS NULL OR s.last_run_at < datetime('now', '-1 day')
      LIMIT 20
    `).all();
    for (const s of sources) {
      console.log(`[autopilot] crawling ${s.url}`);
      await runSource(s).catch((e) => console.log('[autopilot] failed:', e.message));
    }
    if (sources.length) console.log(`[autopilot] done: ${sources.length} source(s)`);
  } catch (e) { console.log('[autopilot] tick failed:', e.message); }
}
setInterval(autopilotTick, 6 * 60 * 60 * 1000); // check every 6h
setTimeout(autopilotTick, 60 * 1000); // first run 1 min after boot
