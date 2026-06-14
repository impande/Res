// Direct Netlify Blobs HTTP API — bypasses SDK context detection entirely.
// Both reads and writes hit the same endpoint with the same credentials.
const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN   = process.env.NETLIFY_AUTH_TOKEN;
const API_BASE = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/portfolios`;

async function blobSet(key, value) {
  const r = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Content-Type': 'text/plain; charset=utf-8'
    },
    body: value
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Blobs write failed (${r.status}): ${body}`);
  }
}

async function blobGet(key) {
  const r = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` }
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`Blobs read failed (${r.status}): ${body}`);
  }
  return await r.text();
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ── POST: save portfolio HTML, return shareable URL ────────────────────
  if (event.httpMethod === 'POST') {
    if (!SITE_ID || !TOKEN) {
      return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'BLOBS_NOT_CONFIGURED' }) };
    }
    try {
      const { html, name } = JSON.parse(event.body || '{}');
      if (!html || !name) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing html or name' }) };

      const slug = (name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60)) || 'portfolio';

      await blobSet(slug, html);

      const siteUrl = (process.env.URL || 'https://resume4u.help').replace(/\/$/, '');
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: siteUrl + '/p/' + slug }) };
    } catch(e) {
      return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'BLOBS_NOT_CONFIGURED' }) };
    }
  }

  // ── GET: serve stored portfolio HTML (via /p/* redirect) ──────────────
  if (event.httpMethod === 'GET') {
    const id = (event.queryStringParameters || {}).id;
    if (!id) return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: notFound() };
    try {
      const html = await blobGet(id);
      if (!html) return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: notFound() };
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        body: html };
    } catch(e) {
      return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
        body: '<h1>Error: ' + e.message + '</h1>' };
    }
  }

  return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
};

function notFound() {
  return '<html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;"><h2>Portfolio not found</h2><p>This link may have expired. Please generate a new one at <a href="https://resume4u.help">resume4u.help</a>.</p></body></html>';
}
