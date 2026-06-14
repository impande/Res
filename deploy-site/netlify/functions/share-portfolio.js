// Netlify Blobs: use SDK with auto-detection first (uses edgeURL if NETLIFY_BLOBS_CONTEXT
// is injected), fall back to explicit credentials only if context is absent.
const { getStore } = require('@netlify/blobs');

const SITE_ID = process.env.NETLIFY_SITE_ID;
const TOKEN   = process.env.NETLIFY_AUTH_TOKEN;
const HAS_CTX = !!process.env.NETLIFY_BLOBS_CONTEXT;

function portfolioStore() {
  if (HAS_CTX) {
    // Full Netlify context available — SDK uses edgeURL, reads are cross-invocation safe
    return getStore('portfolios');
  }
  if (SITE_ID && TOKEN) {
    // Explicit credentials fallback — still uses SDK (correct URL signing)
    return getStore({ name: 'portfolios', siteID: SITE_ID, token: TOKEN });
  }
  throw new Error('BLOBS_NOT_CONFIGURED');
}

async function blobSet(key, value) {
  const store = portfolioStore();
  await store.set(key, value);
}

async function blobGet(key) {
  const store = portfolioStore();
  return await store.get(key);
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
      hasContext: HAS_CTX,
      hasSiteID: !!SITE_ID,
      hasToken: !!TOKEN,
      contextPrefix: process.env.NETLIFY_BLOBS_CONTEXT
        ? process.env.NETLIFY_BLOBS_CONTEXT.substring(0, 30) + '...'
        : 'NOT SET',
    };

    // Test SDK write + read (within same invocation)
    const testKey = '__diag_sdk__';
    const testVal = 'sdk-diag-' + Date.now();
    try {
      await blobSet(testKey, testVal);
      info.write = 'ok';
    } catch(e) {
      info.write = 'ERROR: ' + e.message;
    }
    try {
      const v = await blobGet(testKey);
      info.read = v === null ? 'NULL (not found)'
        : v === testVal ? 'ok (matched)' : 'MISMATCH: ' + String(v).substring(0, 80);
    } catch(e) {
      info.read = 'ERROR: ' + e.message;
    }

    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(info, null, 2) };
  }

  // ── CROSS-INVOCATION TEST: GET ?persist=KEY ────────────────────────────────
  // Write to KEY in this request, then visit /p/KEY to verify it persists
  if (event.httpMethod === 'GET' && qs.persist) {
    const key = qs.persist;
    const val = 'persist-test-' + Date.now();
    const info = { key, val, hasContext: HAS_CTX };
    try {
      await blobSet(key, val);
      info.write = 'ok';
    } catch(e) {
      info.write = 'ERROR: ' + e.message;
    }
    try {
      const v = await blobGet(key);
      info.sameInvocationRead = v === val ? 'ok (matched)' : (v === null ? 'NULL' : 'MISMATCH');
    } catch(e) {
      info.sameInvocationRead = 'ERROR: ' + e.message;
    }
    info.crossInvocationTest = 'Now visit: /p/' + key;
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(info, null, 2) };
  }

  // ── POST: save portfolio HTML, return shareable URL ────────────────────────
  if (event.httpMethod === 'POST') {
    try {
      portfolioStore(); // check credentials
    } catch(e) {
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
      body: notFound() };
    try {
      const html = await blobGet(id);
      if (!html) return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' },
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
