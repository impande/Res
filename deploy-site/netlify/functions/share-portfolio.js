// Serves shared portfolio HTML from Firestore via REST API.
// Writes are done client-side via Firebase SDK; this function only handles GET (serving).
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/resume-ai-2eda1/databases/(default)/documents/portfolios';
const FS_KEY  = 'AIzaSyDUgpJQ8PbQgwqj1EUAe9Va4iG8BnNQm10';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

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
