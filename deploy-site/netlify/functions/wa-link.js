/* wa-link.js — link a logged-in web account to a WhatsApp number.
 *
 * Flow (no Firebase Admin needed — bridges through Upstash):
 *   1. Site (signed-in) POSTs { idToken, resume } here with action=create.
 *   2. We verify the Firebase ID token to get the REAL uid (so a caller can't
 *      claim someone else's account), mirror the resume to webresume:<uid>, and
 *      mint a short code stored at walink:<code> -> uid (10-min TTL).
 *   3. The user sends "LINK <code>" to the bot; whatsapp.js consumes the code,
 *      maps phone -> uid, loads webresume:<uid>, and edits it by chat.
 *
 * Token verification uses the Identity Toolkit REST endpoint with the PUBLIC web
 * apiKey — no service account. The returned localId is the trusted uid.
 */
const FB_KEY = process.env.WEB_FIREBASE_API_KEY || 'AIzaSyDUgpJQ8PbQgwqj1EUAe9Va4iG8BnNQm10';
const BOT = process.env.WA_BOT_NUMBER || '15556758306';

function redisUrl(path) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  return url ? url.replace(/\/$/, '') + path : null;
}
async function redisSet(key, val, ttlSec) {
  const u = redisUrl('/set/' + encodeURIComponent(key) + '?EX=' + ttlSec);
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!u || !tok) return null;
  try {
    const r = await fetch(u, { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'content-type': 'text/plain' }, body: val });
    return (await r.json().catch(() => ({}))).result;
  } catch (e) { console.error('[wa-link] redis set failed', e && e.message); return null; }
}
async function verifyIdToken(idToken) {
  if (!idToken) return null;
  try {
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FB_KEY, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken })
    });
    const j = await r.json().catch(() => ({}));
    const u = j && j.users && j.users[0];
    return u && u.localId ? u.localId : null;
  } catch (e) { console.error('[wa-link] verify failed', e && e.message); return null; }
}
function code6() {
  // unambiguous alphabet (no 0/O/1/I) so it's easy to type into WhatsApp
  var A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s = '';
  for (var i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

exports.handler = async (event) => {
  const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'method' }) };
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad_json' }) }; }

  const action = body.action || 'create';
  if (action !== 'create') return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad_action' }) };

  const uid = await verifyIdToken(body.idToken);
  if (!uid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'not_signed_in' }) };

  // Mirror the current resume so the bot can load it (cloud/builder shape).
  const resume = body.resume && typeof body.resume === 'object' ? body.resume : null;
  if (resume) await redisSet('webresume:' + uid, JSON.stringify(resume), 7776000); // 90 days

  const code = code6();
  await redisSet('walink:' + code, uid, 600); // 10 minutes to use the code

  const waText = encodeURIComponent('LINK ' + code);
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, code: code, bot: BOT, waUrl: 'https://wa.me/' + BOT + '?text=' + waText })
  };
};
