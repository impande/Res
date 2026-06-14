// Netlify Blobs via direct HTTP API with full two-step signed-URL flow.
// Both GET and PUT go through the same pattern:
//   1. Hit the Netlify API with Accept: application/json;type=signed-url
//   2. Follow the returned signed S3 URL for the actual read/write
const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN   = process.env.NETLIFY_AUTH_TOKEN;
const API_BASE = `https://api.netlify.com/api/v1/blobs/${SITE_ID}/portfolios`;

async function blobSet(key, value) {
  // Step 1: request a signed PUT URL from the Blobs API (no body here)
  const r1 = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/json;type=signed-url'
    }
  });
  if (!r1.ok) {
    const txt = await r1.text().catch(() => '');
    throw new Error(`blobSet step1 ${r1.status}: ${txt}`);
  }
  const json1 = await r1.json();
  if (!json1.url) throw new Error(`blobSet step1 no url: ${JSON.stringify(json1)}`);

  // Step 2: PUT actual content to the signed S3 URL
  const r2 = await fetch(json1.url, {
    method: 'PUT',
    headers: { 'Cache-Control': 'max-age=0, stale-while-revalidate=60' },
    body: value
  });
  if (!r2.ok) {
    const txt = await r2.text().catch(() => '');
    throw new Error(`blobSet step2 ${r2.status}: ${txt.substring(0, 300)}`);
  }
}

async function blobGet(key) {
  // Step 1: request a signed GET URL from the Blobs API
  const r1 = await fetch(`${API_BASE}/${encodeURIComponent(key)}`, {
    headers: {
      'Authorization': `Bearer ${TOKEN}`,
      'Accept': 'application/json;type=signed-url'
    }
  });
  if (r1.status === 404) return null;
  if (!r1.ok) {
    const txt = await r1.text().catch(() => '');
    throw new Error(`blobGet step1 ${r1.status}: ${txt}`);
  }
  const json1 = await r1.json();
  if (!json1.url) throw new Error(`blobGet step1 no url: ${JSON.stringify(json1)}`);

  // Step 2: fetch actual content from the signed S3 URL
  const r2 = await fetch(json1.url);
  if (r2.status === 404) return null;
  if (!r2.ok) {
    const txt = await r2.text().catch(() => '');
    throw new Error(`blobGet step2 ${r2.status}: ${txt.substring(0, 300)}`);
  }
  return await r2.text();
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};

  // ── DIAGNOSTIC: GET ?diag=1  (tests write + read cycle) ──────────────────
  if (event.httpMethod === 'GET' && qs.diag === '1') {
    const info = {
      hasSiteID: !!SITE_ID,
      siteIDPrefix: SITE_ID ? SITE_ID.substring(0, 8) + '...' : 'MISSING',
      hasToken: !!TOKEN,
      apiBase: API_BASE.replace(SITE_ID || '', '[SITE_ID]'),
    };
    const testKey = '__diag__';
    const testVal = 'diag-ok-' + Date.now();
    try {
      await blobSet(testKey, testVal);
      info.write = 'ok';
    } catch(e) {
      info.write = 'ERROR: ' + e.message;
    }
    try {
      const v = await blobGet(testKey);
      info.read = v === null ? 'NULL (not found)' : (v === testVal ? 'ok (matched)' : 'MISMATCH got: ' + v.substring(0, 80));
    } catch(e) {
      info.read = 'ERROR: ' + e.message;
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(info, null, 2) };
  }

  // ── POST: save portfolio HTML, return shareable URL ────────────────────────
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
        body: JSON.stringify({ error: 'BLOBS_NOT_CONFIGURED', detail: e.message }) };
    }
  }

  // ── GET: serve stored portfolio HTML (via /p/* redirect) ──────────────────
  if (event.httpMethod === 'GET') {
    const id = qs.id;
    if (!id) return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: notFound('No portfolio ID in request') };
    try {
      const html = await blobGet(id);
      if (!html) return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: notFound('Key "' + id + '" not found in store') };
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        body: html };
    } catch(e) {
      return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
        body: '<h1>Error loading portfolio</h1><pre>' + e.message + '</pre>' };
    }
  }

  return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
};

function notFound(reason) {
  return '<html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;">'
    + '<h2>Portfolio not found</h2>'
    + '<p>This link may have expired. Please generate a new one at <a href="https://resume4u.help">resume4u.help</a>.</p>'
    + (reason ? '<p style="color:#999;font-size:0.8rem">' + reason + '</p>' : '')
    + '</body></html>';
}
