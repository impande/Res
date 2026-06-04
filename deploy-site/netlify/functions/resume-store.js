const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// 3-32 chars, must start/end with [a-z0-9], hyphens allowed in the middle.
const SLUG = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

// Reserved handles so we don't collide with site paths.
const RESERVED = new Set([
  'admin', 'api', 'r', 'new', 'edit', 'login', 'logout',
  'about', 'help', 'support', 'terms', 'privacy', 'static', 'public'
]);

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const randToken = () => crypto.randomBytes(24).toString('base64url');

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' };
  }

  const store = getStore('resumes');

  try {
    if (event.httpMethod === 'GET') {
      const u = ((event.queryStringParameters || {}).u || '').toLowerCase();
      if (!SLUG.test(u)) {
        return json(400, { error: 'Invalid handle' });
      }
      const record = await store.get(u, { type: 'json' });
      if (!record) return json(404, { error: 'Not found' });
      // Never expose the token hash publicly.
      return json(200, { data: record.data, updatedAt: record.updatedAt });
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const username = (body.username || '').trim().toLowerCase();
      const data = body.data;
      const editToken = body.editToken;

      if (!SLUG.test(username) || RESERVED.has(username)) {
        return json(400, { error: 'Handle must be 3-32 chars (a-z, 0-9, hyphens) and not reserved.' });
      }
      if (!data || typeof data !== 'object') {
        return json(400, { error: 'Missing resume data.' });
      }
      const serialized = JSON.stringify(data);
      if (serialized.length > 100_000) {
        return json(413, { error: 'Resume is too large (>100KB).' });
      }

      const existing = await store.get(username, { type: 'json' });

      if (existing) {
        if (!editToken || sha(editToken) !== existing.tokenHash) {
          return json(403, { error: 'This handle is taken. To update it, provide the edit token shown when you first saved.' });
        }
        await store.setJSON(username, {
          data,
          tokenHash: existing.tokenHash,
          createdAt: existing.createdAt,
          updatedAt: new Date().toISOString()
        });
        return json(200, { ok: true, url: `/r/${username}` });
      }

      const token = randToken();
      const now = new Date().toISOString();
      await store.setJSON(username, {
        data,
        tokenHash: sha(token),
        createdAt: now,
        updatedAt: now
      });
      return json(201, { ok: true, url: `/r/${username}`, editToken: token });
    }

    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    return json(500, { error: err.message });
  }
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...CORS, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };
}
