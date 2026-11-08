/* wa-optin.js — start a WhatsApp conversation for someone who can't open
 * WhatsApp on this device (desktop without WhatsApp Desktop/Web).
 *
 * POST { phone, intent, role?, city?, name? }
 *   intent "alerts"    → subscribe to daily job alerts and send the approved
 *                        job-alert template (WA_JOB_ALERT_TEMPLATE, 3 params:
 *                        first name, how many jobs, role). The user replies
 *                        JOBS on their phone to see the list.
 *   intent "resume"    → send WA_START_TEMPLATE (2 params: what they asked
 *   intent "interview"    for, the word to reply) so they can start the chat
 *                        from their phone.
 * Business-initiated messages must be approved templates (Meta charges per
 * template). Without the needed template we answer {status:"unavailable"} and
 * the page falls back to the QR code.
 *
 * Switch: number sign-up is OFF until WA_OPTIN_ENABLED=1 (Meta charges for every
 * message the bot starts, so it needs a payment method on the WhatsApp account).
 * While off, the page leads with the QR code (the user sends the first message,
 * which is free). GET returns which intents are available.
 *
 * Abuse guard: 5 requests / hour / IP, and one message per number per intent
 * every 12 h. The message itself tells the recipient how to stop.
 */
const JOBS = require('../lib/jobs.js');
const GRAPH = 'https://graph.facebook.com/v21.0';
const H = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const out = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });

async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/' + cmd.map(encodeURIComponent).join('/'), { headers: { Authorization: 'Bearer ' + tok } });
    const j = await r.json().catch(() => ({}));
    return j && j.result;
  } catch (e) { console.error('[wa-optin] redis failed', e && e.message); return null; }
}

// 10-digit Indian mobiles get +91; otherwise expect a full international number.
function normPhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) return /^91[6-9]/.test(d) ? d : '';
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) return /^[6-9]/.test(d) ? '91' + d : '';
  if (d.startsWith('00')) d = d.slice(2);
  return d.length >= 11 && d.length <= 15 ? d : '';
}
const clean = (s, n) => String(s || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

async function sendTemplate(to, name, lang, params) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, err: 'WhatsApp is not configured' };
  try {
    const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: { name, language: { code: lang }, components: [{ type: 'body', parameters: params.map((t) => ({ type: 'text', text: String(t).slice(0, 60) })) }] }
      })
    });
    if (r.ok) return { ok: true };
    const t = (await r.text().catch(() => '')).slice(0, 300);
    console.error('[wa-optin] send failed', r.status, t);
    return { ok: false, err: t };
  } catch (e) { return { ok: false, err: e && e.message }; }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: H, body: '' };
  const ON = process.env.WA_OPTIN_ENABLED === '1';
  if (event.httpMethod === 'GET') {
    return { statusCode: 200, headers: Object.assign({}, H, { 'cache-control': 'public, max-age=300' }),
      body: JSON.stringify({ alerts: ON && !!process.env.WA_JOB_ALERT_TEMPLATE, resume: ON && !!process.env.WA_START_TEMPLATE, interview: ON && !!process.env.WA_START_TEMPLATE }) };
  }
  if (event.httpMethod !== 'POST') return out(405, { status: 'error', error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch (e) { return out(400, { status: 'error', error: 'Bad request' }); }

  const intent = ['alerts', 'resume', 'interview'].includes(b.intent) ? b.intent : '';
  if (!intent) return out(400, { status: 'error', error: 'Unknown request' });
  const phone = normPhone(b.phone);
  if (!phone) return out(400, { status: 'bad_phone', error: 'Enter a valid WhatsApp number, e.g. 98765 43210.' });
  const role = clean(b.role, 60), city = clean(b.city, 40), name = clean(b.name, 40);
  if (intent === 'alerts' && role.length < 2) return out(400, { status: 'error', error: 'Enter the role you want jobs for.' });

  const ALERT_T = process.env.WA_JOB_ALERT_TEMPLATE || '', START_T = process.env.WA_START_TEMPLATE || '';
  if (!ON || (intent === 'alerts' ? !ALERT_T : !START_T)) return out(200, { status: 'unavailable' });

  // Rate limits
  const h = event.headers || {};
  const ip = String(h['x-nf-client-connection-ip'] || h['client-ip'] || (h['x-forwarded-for'] || '').split(',')[0] || 'unknown').replace(/[^0-9a-fA-F:.]/g, '').slice(0, 64);
  const n = Number(await redis(['INCR', 'optin:ip:' + ip])) || 0;
  if (n === 1) await redis(['EXPIRE', 'optin:ip:' + ip, '3600']);
  if (n > 5) return out(429, { status: 'limited', error: 'Too many requests from this network. Please try again in an hour.' });
  const fresh = await redis(['SET', 'optin:ph:' + phone + ':' + intent, '1', 'NX', 'EX', '43200']);
  if (fresh === null && process.env.UPSTASH_REDIS_REST_URL) {
    return out(200, { status: 'already', masked: '••••' + phone.slice(-4) });
  }

  let res;
  if (intent === 'alerts') {
    const search = { role: JOBS.titleCase(role), city: JOBS.titleCase(city), skills: [] };
    // Re-subscribing to the same role keeps skills learned from their WhatsApp resume.
    let prev = null; try { prev = JSON.parse((await redis(['GET', 'jobalert:' + phone])) || 'null'); } catch (e) {}
    if (prev && String(prev.role || '').toLowerCase() === search.role.toLowerCase()) search.skills = prev.skills || [];
    await redis(['SET', 'jobalert:' + phone, JSON.stringify({ role: search.role, city: search.city, skills: search.skills, name: name || (prev && prev.name) || '', since: Date.now(), via: 'web' }), 'EX', String(60 * 60 * 24 * 120)]);
    await redis(['SADD', 'jobalerts:subs', phone]);
    let count = 'New';
    try {
      const jr = await Promise.race([JOBS.fetchJobs(search, { maxDays: 3 }), new Promise((r) => setTimeout(() => r(null), 9000))]);
      if (jr && jr.jobs && jr.jobs.length) count = String(Math.min(jr.jobs.length, 5));
    } catch (e) {}
    res = await sendTemplate(phone, ALERT_T, process.env.WA_JOB_ALERT_TEMPLATE_LANG || 'en', [String(name || (prev && prev.name) || '').split(' ')[0] || 'there', count, search.role]);
  } else {
    const what = intent === 'resume' ? 'build your resume' : 'practise interview questions' + (role ? ' for ' + JOBS.titleCase(role) : '');
    const reply = intent === 'resume' ? 'Hi' : 'mock interview' + (role ? ' ' + role : '');
    res = await sendTemplate(phone, START_T, process.env.WA_START_TEMPLATE_LANG || 'en', [what, reply]);
  }
  if (!res.ok) {
    await redis(['DEL', 'optin:ph:' + phone + ':' + intent]);   // let them retry once fixed
    return out(502, { status: 'send_failed', error: "We couldn't message that number on WhatsApp. Check the number, or scan the QR code instead." });
  }
  return out(200, { status: 'sent', masked: '••••' + phone.slice(-4) });
};
