const { getStore } = require('@netlify/blobs');

exports.handler = async function(event) {
  const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  function makeStore() {
    const opts = { name: 'portfolios' };
    if (process.env.NETLIFY_SITE_ID) opts.siteID = process.env.NETLIFY_SITE_ID;
    if (process.env.NETLIFY_AUTH_TOKEN) opts.token = process.env.NETLIFY_AUTH_TOKEN;
    return getStore(opts);
  }

  // ── POST: save portfolio HTML, return clean shareable URL ─────────────
  if (event.httpMethod === 'POST') {
    try {
      const { html, name } = JSON.parse(event.body || '{}');
      if (!html || !name) return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Missing html or name' }) };

      // Build slug: firstname-lastname.com
      const slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60) + '.com';

      const store = makeStore();
      await store.set(slug, html, { metadata: { name, created: Date.now() } });

      const siteUrl = (process.env.URL || 'https://resume4u.help').replace(/\/$/, '');
      return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: siteUrl + '/' + slug }) };
    } catch(e) {
      const msg = e.message || '';
      if (msg.includes('not been configured') || msg.includes('siteID') || msg.includes('token')) {
        return { statusCode: 503, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'BLOBS_NOT_CONFIGURED', message: 'Share link storage is not available. Please download your portfolio instead.' }) };
      }
      return { statusCode: 500, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── GET: serve stored portfolio HTML (called via Netlify redirect) ────
  if (event.httpMethod === 'GET') {
    try {
      const id = (event.queryStringParameters || {}).id;
      if (!id) return { statusCode: 400, headers: { 'Content-Type': 'text/html' }, body: '<h1>Missing portfolio ID</h1>' };
      const store = makeStore();
      const html = await store.get(id);
      if (!html) return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: '<html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;"><h2>Portfolio not found</h2><p>This link may have expired. Please ask the owner to generate a new one at <a href="https://resume4u.help">resume4u.help</a>.</p></body></html>' };
      return { statusCode: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' }, body: html };
    } catch(e) {
      return { statusCode: 500, headers: { 'Content-Type': 'text/html' }, body: '<h1>Error: ' + e.message + '</h1>' };
    }
  }

  return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
};
