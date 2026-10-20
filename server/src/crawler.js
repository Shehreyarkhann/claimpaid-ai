// Autopilot crawler: learn from a website on its own.
// Given a sitemap URL (or a single page), fetch pages, extract text,
// and ingest anything new or changed. Runs on a schedule with zero human input.
const crypto = require('crypto');
const { db } = require('./db');
const { extractUrl, chunkText } = require('./ingest');
const { embed } = require('./embeddings');

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function fetchSitemapUrls(sitemapUrl, limit = 200) {
  const res = await fetch(sitemapUrl, {
    headers: { 'User-Agent': 'AskBaseBot/1.0' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Sitemap fetch failed: ${res.status}`);
  const xml = await res.text();
  // sitemap index -> recurse into child sitemaps
  const childSitemaps = [...xml.matchAll(/<sitemap>[\s\S]*?<loc>(.*?)<\/loc>/gi)].map((m) => m[1].trim());
  let locs = [];
  if (childSitemaps.length) {
    for (const child of childSitemaps.slice(0, 5)) {
      try { locs.push(...await fetchSitemapUrls(child, limit)); } catch {}
      if (locs.length >= limit) break;
    }
  } else {
    locs = [...xml.matchAll(/<url>[\s\S]*?<loc>(.*?)<\/loc>/gi)].map((m) => m[1].trim());
  }
  return [...new Set(locs)].slice(0, limit);
}

async function ingestPage(kb, orgId, pageUrl) {
  const text = await extractUrl(pageUrl);
  if (!text || text.length < 100) return { status: 'skipped', reason: 'too short' };
  const hash = sha256(text);

  const existing = db.prepare(`SELECT id, content_hash FROM documents WHERE kb_id = ? AND source_url = ?`)
    .get(kb.id, pageUrl);
  if (existing && existing.content_hash === hash) return { status: 'unchanged' };

  if (existing) {
    db.prepare('DELETE FROM chunks WHERE doc_id = ?').run(existing.id);
    db.prepare(`UPDATE documents SET status='processing', error=NULL, content_hash=? WHERE id=?`).run(hash, existing.id);
    await embedChunks(kb, orgId, existing.id, text);
    return { status: 'updated' };
  }
  const docId = db.prepare(`
    INSERT INTO documents (kb_id, org_id, filename, source_type, source_url, mime, status, content_hash)
    VALUES (?, ?, ?, 'crawl', ?, 'text/html', 'processing', ?)
  `).run(kb.id, orgId, pageUrl.replace(/^https?:\/\//, '').slice(0, 120), pageUrl, hash).lastInsertRowid;
  await embedChunks(kb, orgId, docId, text);
  return { status: 'new' };
}

async function embedChunks(kb, orgId, docId, text) {
  const pieces = chunkText(text, kb.chunk_size, kb.chunk_overlap);
  const insert = db.prepare(`INSERT INTO chunks (doc_id, kb_id, org_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?, ?, ?)`);
  let idx = 0;
  for (let i = 0; i < pieces.length; i += 16) {
    const batch = pieces.slice(i, i + 16);
    const vecs = await embed(batch);
    db.exec('BEGIN');
    try {
      batch.forEach((t, j) => insert.run(docId, kb.id, orgId, idx++, t, JSON.stringify(vecs[j])));
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }
  db.prepare(`UPDATE documents SET status='ready', char_count=?, chunk_count=? WHERE id=?`)
    .run(text.length, pieces.length, docId);
}

async function runSource(source) {
  const kb = db.prepare('SELECT * FROM knowledge_bases WHERE id = ?').get(source.kb_id);
  if (!kb) throw new Error('KB gone');
  const started = Date.now();
  let found = 0, fresh = 0, updated = 0;
  try {
    let urls;
    if (source.type === 'sitemap') {
      urls = await fetchSitemapUrls(source.url, source.crawl_limit);
    } else {
      urls = [source.url];
    }
    // same-domain safety: only crawl pages under the source's origin
    const origin = new URL(source.url).origin;
    urls = urls.filter((u) => { try { return new URL(u).origin === origin; } catch { return false; } });
    found = urls.length;
    for (const u of urls) {
      try {
        const r = await ingestPage(kb, source.org_id, u);
        if (r.status === 'new') fresh++;
        if (r.status === 'updated') updated++;
      } catch (e) { /* per-page failure: keep going */ }
      // be polite
      await new Promise((r) => setTimeout(r, 400));
    }
    db.prepare(`UPDATE sources SET last_run_at=datetime('now'), last_status=?, last_found=?, last_new=? WHERE id=?`)
      .run(`ok (${fresh} new, ${updated} updated)`, found, fresh + updated, source.id);
  } catch (e) {
    db.prepare(`UPDATE sources SET last_run_at=datetime('now'), last_status=? WHERE id=?`)
      .run('failed: ' + String(e.message).slice(0, 200), source.id);
  }
  return { found, fresh, updated, ms: Date.now() - started };
}

module.exports = { runSource, ingestPage, fetchSitemapUrls };
