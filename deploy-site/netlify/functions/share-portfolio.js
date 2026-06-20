const { getStore } = require('@netlify/blobs');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

  const qs = event.queryStringParameters || {};

  // ── POST: save portfolio HTML, return shareable URL ───────────────────────
  if (event.httpMethod === 'POST') {
    try {
      const bodyStr = event.body || '{}';
      if (bodyStr.length > 1200000) {
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

      const slug = (name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .substring(0, 60)) || 'portfolio';

      const store = getStore('portfolios');
      await store.set(slug, html);

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
    const id = qs.id;
    if (!id) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: notFound(),
      };
    }
    try {
      const store = getStore('portfolios');
      const html = await store.get(id);
      if (!html) {
        return {
          statusCode: 404,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          body: notFound(),
        };
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
    + '<p>This link may have expired (90 days). Generate a new one at '
    + '<a href="https://resume4u.help">resume4u.help</a>.</p>'
    + '</body></html>';
}
