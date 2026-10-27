/* resume.js — serve a WhatsApp-built resume to the website.
 *
 * The WhatsApp co-pilot stashes a finished resume in Upstash under
 * `resume:<token>` (7-day TTL) and hands the user a link:
 *   https://resume4u.help/?r=<token>
 * The site's `?r=` loader fetches GET /.netlify/functions/resume?token=<token>
 * and prefills the builder with the returned JSON.
 *
 * Read-only, same-origin. Tokens are short random strings; we only ever read
 * the `resume:` namespace, never write.
 */
async function redisGet(key) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/GET/' + encodeURIComponent(key), {
      headers: { Authorization: 'Bearer ' + tok }
    });
    const j = await r.json().catch(() => ({}));
    return j && j.result;
  } catch (e) {
    console.error('[resume] redis get failed:', e && e.message);
    return null;
  }
}

exports.handler = async (event) => {
  const headers = {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  };
  const q = (event.queryStringParameters || {});
  const token = (q.token || q.r || '').trim();
  // Tokens are generated as Math.random().toString(36).slice(2,10) — [a-z0-9], short.
  if (!token || !/^[a-z0-9]{4,24}$/i.test(token)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad_token' }) };
  }
  const raw = await redisGet('resume:' + token);
  if (!raw) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
  }
  let data;
  try { data = JSON.parse(raw); } catch (e) { data = null; }
  if (!data) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'not_found' }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, resume: data }) };
};
