/* support-admin.js — owner's in-house support desk for the WhatsApp bot number.
 *
 * One number serves both the bot and human support. When a user asks for support,
 * whatsapp.js puts them in "support" mode and logs the chat to ticket:<from> (open
 * ones tracked in the set tickets:open). This function lets the owner list those
 * tickets, read a conversation, reply (sent back through the WhatsApp Cloud API),
 * and resolve (hand the chat back to the bot).
 *
 * Guarded by SUPPORT_ADMIN_TOKEN (falls back to WHATSAPP_VERIFY_TOKEN).
 */
const GRAPH = 'https://graph.facebook.com/v21.0';

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/' + cmd.map(encodeURIComponent).join('/'), {
      headers: { Authorization: 'Bearer ' + tok }
    });
    const j = await r.json().catch(() => ({}));
    return j && j.result;
  } catch (e) { console.error('[support-admin] redis failed', e && e.message); return null; }
}
async function getTicket(from) {
  const v = await redis(['GET', 'ticket:' + from]);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return null;
}
async function saveTicket(from, t) {
  await redis(['SET', 'ticket:' + from, JSON.stringify(t), 'EX', '2592000']);
}
async function send(to, text) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) { console.log('[support-admin] NOT SENT — missing token/phoneId. Would send to', to, ':', text); return false; }
  try {
    const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: to, type: 'text', text: { body: text } })
    });
    return r.ok;
  } catch (e) { console.error('[support-admin] send failed', e && e.message); return false; }
}

exports.handler = async (event) => {
  const H = { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };

  const q = event.queryStringParameters || {};
  let body = {};
  if (event.httpMethod === 'POST') { try { body = JSON.parse(event.body || '{}'); } catch (e) {} }
  const token = body.token || q.token || '';
  const ADMIN = process.env.SUPPORT_ADMIN_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || '';
  if (!ADMIN || token !== ADMIN) return { statusCode: 401, headers: H, body: JSON.stringify({ error: 'unauthorized' }) };

  const action = body.action || q.action || 'list';

  // LIST open tickets (summaries)
  if (action === 'list') {
    const froms = (await redis(['SMEMBERS', 'tickets:open'])) || [];
    const list = [];
    for (const f of froms) {
      const t = await getTicket(f);
      if (!t) { await redis(['SREM', 'tickets:open', f]); continue; }
      const last = t.messages[t.messages.length - 1] || {};
      list.push({ from: f, name: t.name || '', status: t.status || 'open', count: t.messages.length, lastWho: last.who || '', lastText: (last.text || '').slice(0, 120), updatedAt: t.updatedAt || t.createdAt || 0 });
    }
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, tickets: list }) };
  }

  // GET one conversation
  if (action === 'get') {
    const from = (body.from || q.from || '').trim();
    const t = await getTicket(from);
    if (!t) return { statusCode: 404, headers: H, body: JSON.stringify({ error: 'not_found' }) };
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true, ticket: t }) };
  }

  // REPLY to the user (send via Cloud API + log)
  if (action === 'reply') {
    const from = (body.from || '').trim();
    const text = (body.text || '').trim();
    if (!from || !text) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'missing from/text' }) };
    const ok = await send(from, text);
    let t = await getTicket(from) || { from: from, name: '', status: 'open', messages: [], createdAt: Date.now() };
    t.messages.push({ who: 'agent', text: text, ts: Date.now() });
    t.status = 'open'; t.updatedAt = Date.now();
    await saveTicket(from, t);
    await redis(['SADD', 'tickets:open', from]);
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: ok, sent: ok }) };
  }

  // RESOLVE — close the ticket and hand the chat back to the bot
  if (action === 'resolve') {
    const from = (body.from || '').trim();
    if (!from) return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'missing from' }) };
    const t = await getTicket(from);
    if (t) { t.status = 'resolved'; t.updatedAt = Date.now(); await saveTicket(from, t); }
    await redis(['SREM', 'tickets:open', from]);
    // return the user to the normal bot
    await redis(['SET', 'wa:' + from, JSON.stringify({ step: 0, mode: 'idle', data: { experiences: [] } }), 'EX', '86400']);
    if (body.notify !== false) await send(from, "✅ Your support chat has been closed by our team. Message anytime to build or edit your resume — or say \"support\" to reach us again.");
    return { statusCode: 200, headers: H, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, headers: H, body: JSON.stringify({ error: 'bad_action' }) };
};
