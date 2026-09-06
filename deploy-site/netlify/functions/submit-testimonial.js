// Accepts a testimonial submission from a visitor and stores it as PENDING in
// Firestore (testimonials collection). The portfolio owner approves it later in
// the builder; only approved testimonials render on the live site.
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/resume-ai-2eda1/databases/(default)/documents';
const FS_KEY  = 'AIzaSyDUgpJQ8PbQgwqj1EUAe9Va4iG8BnNQm10';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function clean(s, max) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max); }

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
  try {
    const body = JSON.parse(event.body || '{}');
    const slug  = clean(body.slug, 80).replace(/[^a-z0-9_-]/gi, '');
    const quote = clean(body.quote, 700);
    const name  = clean(body.name, 90);
    const role  = clean(body.role, 120);
    if (!slug)  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Missing portfolio' }) };
    if (quote.length < 4) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Please write a testimonial' }) };
    if (!name)  return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Please add your name' }) };

    // Confirm the portfolio exists (avoids spam to random slugs)
    const chk = await fetch(`${FS_BASE}/portfolios/${encodeURIComponent(slug)}?key=${FS_KEY}&mask.fieldPaths=views`);
    if (chk.status === 404) return { statusCode: 404, headers: CORS, body: JSON.stringify({ error: 'Portfolio not found' }) };

    const doc = {
      fields: {
        slug:   { stringValue: slug },
        quote:  { stringValue: quote },
        name:   { stringValue: name },
        role:   { stringValue: role },
        status: { stringValue: 'pending' },
        ts:     { timestampValue: new Date().toISOString() },
      },
    };
    const res = await fetch(`${FS_BASE}/testimonials?key=${FS_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
    });
    if (!res.ok) {
      const e = await res.text();
      throw new Error('Firestore write ' + res.status + ': ' + e);
    }
    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
