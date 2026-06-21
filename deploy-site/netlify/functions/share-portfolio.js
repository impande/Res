// Stores and serves shared portfolio HTML via Firestore REST API.
// Using REST API (not SDK) so writes get real server confirmation — no local-cache false-success.
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/resume-ai-2eda1/databases/(default)/documents/portfolios';
const FS_KEY  = 'AIzaSyDUgpJQ8PbQgwqj1EUAe9Va4iG8BnNQm10';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  // ── POST: client sends HTML → write to Firestore → return shareable URL ──
  if (event.httpMethod === 'POST') {
    try {
      const bodyStr = event.body || '{}';
      if (bodyStr.length > 950000) {
        return {
          statusCode: 413,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'PAYLOAD_TOO_LARGE', detail: 'Portfolio is too large to share. Download it instead.' }),
        };
      }
      const { html, name } = JSON.parse(bodyStr);
      if (!html || !name) {
        return {
          statusCode: 400,
          headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ error: 'Missing html or name' }),
        };
      }

      // Clean slug — no timestamp so URL stays as /p/first-last
      const slug = (name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60)) || 'portfolio';

      // PATCH creates-or-updates the Firestore document (real server round-trip, no SDK caching)
      const fsResp = await fetch(`${FS_BASE}/${slug}?key=${FS_KEY}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { html: { stringValue: html } } }),
      });

      if (!fsResp.ok) {
        const err = await fsResp.json().catch(() => ({}));
        if (err.error && err.error.status === 'PERMISSION_DENIED') {
          return {
            statusCode: 503,
            headers: { ...CORS, 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'STORAGE_NOT_CONFIGURED', detail: 'Firestore portfolios collection needs write rules.' }),
          };
        }
        throw new Error('Firestore write ' + fsResp.status + ': ' + (err.error && err.error.message || JSON.stringify(err)));
      }

      const siteUrl = (process.env.URL || 'https://resume4u.help').replace(/\/$/, '');
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: siteUrl + '/p/' + slug }),
      };
    } catch (e) {
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'SERVER_ERROR', detail: e.message }),
      };
    }
  }

  // ── GET: serve stored portfolio HTML (via /p/:slug redirect) ─────────────
  if (event.httpMethod === 'GET') {
    const id = (event.queryStringParameters || {}).id;
    if (!id) {
      return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' }, body: notFound() };
    }
    try {
      const fsResp = await fetch(`${FS_BASE}/${encodeURIComponent(id)}?key=${FS_KEY}`);
      if (fsResp.status === 404) {
        return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: notFound() };
      }
      if (!fsResp.ok) {
        const err = await fsResp.json().catch(() => ({}));
        if (err.error && (err.error.status === 'NOT_FOUND' || err.error.status === 'PERMISSION_DENIED')) {
          return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: notFound() };
        }
        throw new Error('Firestore read ' + fsResp.status + ': ' + JSON.stringify(err));
      }
      const doc = await fsResp.json();
      const html = doc.fields && doc.fields.html && doc.fields.html.stringValue;
      if (!html) {
        return { statusCode: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: notFound() };
      }
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
        body: html,
      };
    } catch (e) {
      return {
        statusCode: 500,
        headers: { 'Content-Type': 'text/html' },
        body: '<h1>Error</h1><pre>' + e.message + '</pre>',
      };
    }
  }

  return { statusCode: 405, headers: CORS, body: 'Method not allowed' };
};

function notFound() {
  return '<html><body style="font-family:sans-serif;text-align:center;padding:80px 20px;">'
    + '<h2>Portfolio not found</h2>'
    + '<p>This link may have expired. Generate a new one at '
    + '<a href="https://resume4u.help">resume4u.help</a>.</p>'
    + '</body></html>';
}
