// Storage: Upstash Redis via REST API — reliable cross-invocation persistence.
// Free tier: 10k requests/day, 256MB. Portfolio links expire after 90 days.
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function isConfigured() {
  return !!(UPSTASH_URL && UPSTASH_TOKEN);
}

async function blobSet(key, value) {
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    // SET key value EX 7776000 (90 days TTL)
    body: JSON.stringify(['SET', 'pf:' + key, value, 'EX', 7776000])
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Redis SET ${r.status}: ${txt.substring(0, 200)}`);
  }
}

async function blobGet(key) {
  const r = await fetch(UPSTASH_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${UPSTASH_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(['GET', 'pf:' + key])
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`Redis GET ${r.status}: ${txt.substring(0, 200)}`);
  }
  const json = await r.json();
  return json.result || null;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};

  // ── DIAGNOSTIC: GET ?diag=1 ────────────────────────────────────────────────
  if (event.httpMethod === 'GET' && qs.diag === '1') {
    const info = {
      configured: isConfigured(),
      hasUrl: !!UPSTASH_URL,
      hasToken: !!UPSTASH_TOKEN,
    };
    if (isConfigured()) {
      const testKey = '__diag__';
      const testVal = 'diag-' + Date.now();
      try {
        await blobSet(testKey, testVal);
        info.write = 'ok';
      } catch(e) { info.write = 'ERROR: ' + e.message; }
      try {
        const v = await blobGet(testKey);
        info.read = v === testVal ? 'ok (matched)' : (v === null ? 'NULL' : 'MISMATCH: ' + String(v).substring(0, 50));
      } catch(e) { info.read = 'ERROR: ' + e.message; }
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(info, null, 2) };
  }

  // ── CHECK KEY: GET ?check=KEY  (reads directly from Redis and shows raw result) ─
  if (event.httpMethod === 'GET' && qs.check) {
    const key = qs.check;
    const redisKey = 'pf:' + key;
    const info = { key, redisKey };
    try {
      const r = await fetch(UPSTASH_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${UPSTASH_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', redisKey])
      });
      const json = await r.json();
      info.status = r.status;
      info.result = json.result === null ? 'NULL (key does not exist in Redis)'
        : 'EXISTS, length=' + String(json.result).length + ', preview=' + String(json.result).substring(0, 80);
    } catch(e) { info.error = e.message; }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(info, null, 2) };
  }

  // ── GET ?photo=SLUG: serve stored profile photo as binary JPEG ─────────────
  // The HTML references this URL instead of embedding base64 inline, which
  // keeps the stored HTML small and avoids any size limits.
  if (event.httpMethod === 'GET' && qs.photo) {
    const slug = qs.photo;
    if (!isConfigured()) return { statusCode: 404, headers: CORS, body: '' };
    try {
      const base64 = await blobGet('photo:' + slug);
      if (!base64) return { statusCode: 404,
        headers: { ...CORS, 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' },
        body: '' };
      return { statusCode: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=7776000',
          'Access-Control-Allow-Origin': '*' },
        body: base64,
        isBase64Encoded: true };
    } catch(e) {
      return { statusCode: 500, headers: CORS, body: '' };
    }
  }

  // ── POST: save portfolio HTML (+ optional photo), return shareable URL ──────
  if (event.httpMethod === 'POST') {
    if (!isConfigured()) {
      return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'BLOBS_NOT_CONFIGURED' }) };
    }
    try {
      const bodyStr = event.body || '{}';
      if (bodyStr.length > 1200000) {
        return { statusCode: 413, headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', detail: 'Portfolio is too large to share. Download it instead.' }) };
      }
      const { html, name, photo } = JSON.parse(bodyStr);
      if (!html || !name) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing html or name' }) };

      const slug = (name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60)) || 'portfolio';

      // Store compressed photo separately (raw base64, data: prefix stripped).
      // HTML references it via /.netlify/functions/share-portfolio?photo=<slug>.
      if (photo && typeof photo === 'string' && photo.length < 200000) {
        const base64 = photo.includes(',') ? photo.split(',')[1] : photo;
        if (base64) await blobSet('photo:' + slug, base64);
      }

      await blobSet(slug, html);

      const siteUrl = (process.env.URL || 'https://resume4u.help').replace(/\/$/, '');
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: siteUrl + '/p/' + slug }) };
    } catch(e) {
      return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'SERVER_ERROR', detail: e.message }) };
    }
  }

  // ── GET: serve stored portfolio HTML (via /p/* redirect) ──────────────────
  if (event.httpMethod === 'GET') {
    const id = qs.id;
    if (!id) return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: notFound() };
    if (!isConfigured()) return { statusCode: 503, headers: { 'Content-Type': 'text/html' },
      body: '<h1>Share link service not configured.</h1>' };
    try {
      const html = await blobGet(id);
      if (!html) return { statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache', 'Netlify-CDN-Cache-Control': 'no-store' },
        body: notFound() };
      return { statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        body: html };
    } catch(e) {
      return { statusCode: 500, headers: { 'Content-Type': 'text/html' },
        body: '<h1>Error</h1><pre>' + e.message + '</pre>' };
    }
  }

  return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
};

function notFound() {
  return '<html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;">'
    + '<h2>Portfolio not found</h2>'
    + '<p>This link may have expired. Please generate a new one at '
    + '<a href="https://resume4u.help">resume4u.help</a>.</p>'
    + '</body></html>';
}
