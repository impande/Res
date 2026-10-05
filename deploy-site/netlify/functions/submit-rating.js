// Accepts a product rating (1–5 stars + optional text) and stores it in Firestore
// (`ratings` collection). Also best-effort increments a running aggregate doc
// (`aggregates/productRating` → {sum, count}) so landing pages can later show a
// genuine "★ 4.8 (N reviews)" badge + AggregateRating schema without scanning the
// whole collection. Ratings are first-party and genuine; nothing is fabricated.
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
    const stars = parseInt(body.stars, 10);
    if (!(stars >= 1 && stars <= 5)) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'stars must be 1–5' }) };
    }
    const text  = clean(body.text, 700);
    const uid   = clean(body.uid, 128).replace(/[^a-zA-Z0-9_-]/g, '');
    const email = clean(body.email, 160).toLowerCase();
    const where = clean(body.where, 40);

    // Store the rating. status 'public' for 4–5★ (eligible to display as a review);
    // 1–3★ kept 'private' (internal feedback only, routed to the owner).
    const doc = {
      fields: {
        stars:  { integerValue: String(stars) },
        text:   { stringValue: text },
        uid:    { stringValue: uid },
        email:  { stringValue: email },
        where:  { stringValue: where },
        status: { stringValue: stars >= 4 ? 'public' : 'private' },
        ts:     { timestampValue: new Date().toISOString() },
      },
    };
    const res = await fetch(`${FS_BASE}/ratings?key=${FS_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
    });
    if (!res.ok) {
      const e = await res.text();
      throw new Error('Firestore write ' + res.status + ': ' + e);
    }

    // Best-effort: bump the running aggregate via a commit with field transforms
    // (atomic increment). If this fails, the rating itself is still saved.
    try {
      const commit = {
        writes: [{
          transform: {
            document: `projects/resume-ai-2eda1/databases/(default)/documents/aggregates/productRating`,
            fieldTransforms: [
              { fieldPath: 'sum',   increment: { integerValue: String(stars) } },
              { fieldPath: 'count', increment: { integerValue: '1' } },
            ],
          },
        }],
      };
      await fetch(`${FS_BASE.replace(/\/documents$/, '')}:commit?key=${FS_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(commit),
      });
    } catch (e) { /* aggregate is a convenience; ignore failures */ }

    return { statusCode: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
