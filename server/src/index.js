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
app.use('/api/keys', require('./routes/apikeys'));
app.use('/api/v1', require('./routes/apikeys').v1);
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
