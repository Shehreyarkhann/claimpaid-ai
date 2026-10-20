// Document ingestion: extract text from files/URLs, then chunk it.
const mammoth = require('mammoth');

async function extractPdf(buffer) {
  const pdf = require('pdf-parse');
  const data = await pdf(buffer);
  return (data.text || '').trim();
}

async function extractDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return (value || '').trim();
}

function extractText(buffer, mime, filename = '') {
  const name = (filename || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return extractPdf(buffer);
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx'))
    return extractDocx(buffer);
  // txt / md / csv / anything text-ish
  return Promise.resolve(buffer.toString('utf-8').trim());
}

async function extractUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('Invalid URL'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Only http(s) URLs are supported');
  const res = await fetch(u.toString(), {
    headers: { 'User-Agent': 'AskBaseBot/1.0 (+https://askbase.example.com)' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  if (!/text\/html|text\/plain/.test(ct)) throw new Error(`Unsupported content type: ${ct}`);
  const html = await res.text();
  if (/text\/plain/.test(ct)) return html.trim().slice(0, 200000);
  return htmlToText(html).slice(0, 200000);
}

function htmlToText(html) {
  let t = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ');
  // prefer article/main content when present
  const m = t.match(/<article[\s\S]*?<\/article>/i) || t.match(/<main[\s\S]*?<\/main>/i);
  if (m) t = m[0];
  t = t
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return t.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l.length > 1).join('\n');
}

// Recursive character splitter: paragraphs → sentences → words
function chunkText(text, chunkSize = 1000, overlap = 200) {
  const clean = String(text).replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= chunkSize) return [clean];

  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + chunkSize, clean.length);
    if (end < clean.length) {
      // try to break at a paragraph, then sentence, then space
      const slice = clean.slice(start, end);
      const para = slice.lastIndexOf('\n\n');
      const sent = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
      const space = slice.lastIndexOf(' ');
      const cut = para > chunkSize * 0.4 ? para : sent > chunkSize * 0.4 ? sent + 1 : space > chunkSize * 0.4 ? space : slice.length;
      end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

module.exports = { extractText, extractUrl, chunkText, htmlToText };
