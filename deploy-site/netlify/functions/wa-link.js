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
async function redisGet(key) {
  const u = redisUrl('/get/' + encodeURIComponent(key));
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!u || !tok) return null;
  try {
    const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } });
    return (await r.json().catch(() => ({}))).result;
  } catch (e) { console.error('[wa-link] redis get failed', e && e.message); return null; }
}
async function redisDel(key) {
  const u = redisUrl('/del/' + encodeURIComponent(key));
  const tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!u || !tok) return null;
  try {
    const r = await fetch(u, { method: 'POST', headers: { Authorization: 'Bearer ' + tok } });
    return (await r.json().catch(() => ({}))).result;
  } catch (e) { console.error('[wa-link] redis del failed', e && e.message); return null; }
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
  const KNOWN = ['create', 'sync', 'versions', 'pending-get', 'pending-clear'];
  if (KNOWN.indexOf(action) < 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'bad_action' }) };

  const uid = await verifyIdToken(body.idToken);
  if (!uid) return { statusCode: 401, headers, body: JSON.stringify({ error: 'not_signed_in' }) };

  // Pending WhatsApp edit awaiting apply-on-next-web-visit. The bot writes
  // wapending:<uid> when a linked user finishes editing by chat; the signed-in
  // website reads it on load, offers to apply, then clears it.
  if (action === 'pending-get') {
    const raw = await redisGet('wapending:' + uid);
    let pending = null; try { pending = raw ? JSON.parse(raw) : null; } catch (e) {}
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, pending: pending || null }) };
  }
  if (action === 'pending-clear') {
    await redisDel('wapending:' + uid);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  // Mirror the current resume so the bot always has the latest (cloud/builder shape).
  const resume = body.resume && typeof body.resume === 'object' ? body.resume : null;
  if (resume) await redisSet('webresume:' + uid, JSON.stringify(resume), 7776000); // 90 days

  // versions = mirror the user's saved-version LIST so the bot can show them and
  // let the user pick one to edit by chat. Each entry: {id,label,resume}. The web
  // reads these from its own Firestore (the signed-in user's own data) and pushes
  // them here; we store the latest few so the value stays small.
  if (action === 'versions') {
    let list = Array.isArray(body.versions) ? body.versions : [];
    list = list
      .filter((v) => v && v.resume && typeof v.resume === 'object')
      .slice(0, 15)
      .map((v) => ({ id: String(v.id || '').slice(0, 64), label: String(v.label || 'Resume').slice(0, 80), resume: v.resume }));
    if (list.length) await redisSet('waversions:' + uid, JSON.stringify(list), 7776000); // 90 days
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, count: list.length }) };
  }

  // sync = just refresh the mirror (fired on web save for already-linked users).
  if (action === 'sync') return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };

  const code = code6();
  await redisSet('walink:' + code, uid, 600); // 10 minutes to use the code

  const waText = encodeURIComponent('LINK ' + code);
  return {
    statusCode: 200, headers,
    body: JSON.stringify({ ok: true, code: code, bot: BOT, waUrl: 'https://wa.me/' + BOT + '?text=' + waText })
  };
};
