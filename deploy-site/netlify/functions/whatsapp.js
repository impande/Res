/* WhatsApp Resume Co-pilot — webhook (Meta WhatsApp Cloud API).
 *
 * Builds a resume one reply at a time, in the gaps of someone's day: the bot asks
 * ONE question, the user sends ONE answer, Claude polishes it into resume-grade
 * wording, and the draft assembles in the background. At the end it hands back a
 * link to finish/download on resume4u.help.
 *
 * STATUS: reference scaffold. It is inert until you connect WhatsApp (env vars
 * below). Conversation state uses Upstash Redis (same provider the app already
 * uses); without it, state falls back to in-memory and resets on cold start —
 * fine for a smoke test, not for production.
 *
 * Required env vars (Netlify → Site settings → Environment):
 *   WHATSAPP_TOKEN            - permanent access token from Meta
 *   WHATSAPP_PHONE_NUMBER_ID  - the sending number's ID
 *   WHATSAPP_VERIFY_TOKEN     - any secret string; also paste it in Meta webhook setup
 *   ANTHROPIC_API_KEY         - reused for the AI polish
 *   UPSTASH_REDIS_REST_URL    - (recommended) for durable conversation state
 *   UPSTASH_REDIS_REST_TOKEN
 *
 * Meta setup: create a WhatsApp app, add this function's URL as the webhook
 * callback (field: "messages"), use WHATSAPP_VERIFY_TOKEN as the verify token.
 */

const GRAPH = 'https://graph.facebook.com/v21.0';
// Base URL for the finish link. Derive it from the host the webhook was called
// on, so the ?r= loader that handles the handoff is always on the SAME deploy as
// this function: a UAT branch-deploy keeps the link on UAT, production keeps it
// on prod. Netlify's CONTEXT/DEPLOY_PRIME_URL aren't reliably in the function
// runtime, but the request host always is.
function siteBase(event) {
  var h = '';
  try { h = (event && event.headers && (event.headers.host || event.headers.Host)) || ''; } catch (e) {}
  if (h === 'resume4help.netlify.app') return 'https://resume4u.help'; // canonical prod domain
  if (h) return 'https://' + h;
  return process.env.R4U_SITE_URL || 'https://resume4u.help';
}
const _mem = {};        // in-memory fallback conversation state (per warm instance)
const _memProfile = {}; // in-memory fallback saved resume (per warm instance)

/* ---- durable state (Upstash Redis REST, optional) ---- */
async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  // Fail soft: if the REST call can't be made (wrong URL, Upstash down), fall
  // back to in-memory state instead of throwing and breaking the whole handler.
  try {
    const r = await fetch(url.replace(/\/$/, '') + '/' + cmd.map(encodeURIComponent).join('/'), {
      headers: { Authorization: 'Bearer ' + tok }
    });
    const j = await r.json().catch(() => ({}));
    return j && j.result;
  } catch (e) {
    console.error('[whatsapp] redis fetch failed:', e && e.message);
    return null;
  }
}
async function getState(from) {
  const v = await redis(['GET', 'wa:' + from]);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return _mem[from] || { step: 0, mode: 'idle', data: { experiences: [] } };
}
async function setState(from, state) {
  _mem[from] = state;
  await redis(['SET', 'wa:' + from, JSON.stringify(state), 'EX', '86400']); // 24h TTL
}
// A finished resume, remembered per phone number so returning users can edit it.
async function getProfile(from) {
  const v = await redis(['GET', 'profile:' + from]);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return _memProfile[from] || null;
}
async function setProfile(from, data) {
  _memProfile[from] = data;
  await redis(['SET', 'profile:' + from, JSON.stringify(data), 'EX', '7776000']); // 90 days
}

/* ---- the conversation script ---- */
// Each step: a question to send, and how to store the user's answer.
const STEPS = [
  { ask: "Hi! 👋 I'm your Resume4U co-pilot. I'll build your resume one quick question at a time — reply whenever you get a minute.\n\n📄 Already have a resume? Just send it here as a PDF (or a clear photo) and I'll import it.\n\nOtherwise, let's start: what's your full name?",
    save: (d, t) => { d.name = t; } },
  { ask: (d) => `Nice to meet you, ${firstName(d.name)}! What role are you aiming for? (e.g. "Backend Developer")`,
    save: (d, t) => { d.role = t; } },
  { ask: "How many years of experience do you have? (a number is fine — 0 for fresher)",
    save: (d, t) => { d.years = t; } },
  { ask: "What's your most recent job title and company? (e.g. \"Analyst at Infosys\")",
    save: (d, t) => { d.lastRole = t; } },
  { ask: "In one message, tell me 1–3 things you actually did or achieved there — plain words are fine, I'll sharpen them. 💪",
    save: async (d, t) => { d.experiences.push({ role: d.lastRole, bullets: await polishBullets(t, d.role) }); } },
  { ask: "Your highest qualification + institute? (e.g. \"B.Tech, IIT Delhi, 2024\")",
    save: (d, t) => { d.education = t; } },
  { ask: "Finally — list your key skills, comma-separated. (e.g. \"Python, SQL, React\")",
    save: (d, t) => { d.skills = t.split(/[,\n]/).map((s) => s.trim()).filter(Boolean); } }
];

function firstName(n) { return (n || '').trim().split(/\s+/)[0] || 'there'; }

/* ---- AI polish (Anthropic) ---- */
async function claude(prompt, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTokens || 400, messages: [{ role: 'user', content: prompt }] })
  });
  const j = await r.json().catch(() => ({}));
  const c = j && j.content;
  return (Array.isArray(c) ? (c[0] && c[0].text) || '' : '').trim();
}
async function polishBullets(raw, role) {
  const out = await claude(
    `Turn the candidate's plain-language notes into 1-3 strong resume bullet points for a "${role || 'professional'}" role. ` +
    `Start each with a strong verb, keep each under 22 words, don't invent numbers they didn't give (use [X]% / [N]+ placeholders where a metric would help). ` +
    `Output ONLY the bullets, one per line, no preamble.\n\nNOTES: ${raw}`, 400
  );
  return out ? out.split('\n').map((s) => s.replace(/^[-•\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3)
             : [raw];
}

/* ---- import an existing resume (PDF or photo) via Claude ---- */
async function fetchMedia(mediaId) {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token || !mediaId) return null;
  const meta = await fetch(`${GRAPH}/${mediaId}`, { headers: { Authorization: 'Bearer ' + token } });
  const mj = await meta.json().catch(() => ({}));
  if (!mj || !mj.url) return null;
  const bin = await fetch(mj.url, { headers: { Authorization: 'Bearer ' + token } });
  if (!bin.ok) return null;
  const buf = Buffer.from(await bin.arrayBuffer());
  return { base64: buf.toString('base64'), mime: mj.mime_type || 'application/pdf' };
}
async function claudeExtractResume(base64, mime) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || !base64) return null;
  const isPdf = /pdf/i.test(mime || '');
  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: base64 } };
  const instruction = { type: 'text', text:
    'Extract this resume into STRICT JSON with exactly these keys and nothing else: ' +
    '{"name":"","role":"","years":"","education":"","skills":[],"experiences":[{"role":"","bullets":[]}]}. ' +
    'role = the person\'s current or target job title. years = total years of experience as a short string. ' +
    'experiences: one object per job (most recent first), role = "Title at Company", bullets = 2-4 concise achievement bullets keeping the resume\'s own wording. ' +
    'skills = flat array of individual skills. Use "" or [] where unknown. Output ONLY the JSON object — no markdown, no preamble.' };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, messages: [{ role: 'user', content: [fileBlock, instruction] }] })
  });
  const j = await r.json().catch(() => ({}));
  const c = j && j.content;
  let txt = (Array.isArray(c) ? (c[0] && c[0].text) || '' : '').trim();
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const data = JSON.parse(m[0]);
    if (!Array.isArray(data.experiences)) data.experiences = [];
    if (!Array.isArray(data.skills)) data.skills = [];
    return data;
  } catch (e) { return null; }
}

/* ---- a short human summary of the collected resume ---- */
function summarize(d) {
  const parts = [];
  if (d.name) parts.push('👤 ' + d.name);
  if (d.role) parts.push('🎯 ' + d.role);
  if (d.years) parts.push('🕒 ' + d.years + ' yrs experience');
  if (Array.isArray(d.experiences) && d.experiences.length) parts.push('💼 ' + d.experiences.length + ' role(s)');
  if (Array.isArray(d.skills) && d.skills.length) parts.push('🛠️ ' + d.skills.slice(0, 8).join(', ') + (d.skills.length > 8 ? '…' : ''));
  if (d.education) parts.push('🎓 ' + d.education);
  return parts.join('\n') || '(nothing captured yet)';
}

/* ---- apply a plain-language edit command to the resume data ---- */
function applyEdit(d, text) {
  const t = (text || '').trim();
  let m;
  if (!Array.isArray(d.skills)) d.skills = [];
  if (!Array.isArray(d.experiences)) d.experiences = [];
  if ((m = t.match(/^name\s*[:=]\s*(.+)$/is))) { d.name = m[1].trim(); return 'name'; }
  if ((m = t.match(/^(?:role|title|target)\s*[:=]\s*(.+)$/is))) { d.role = m[1].trim(); return 'role'; }
  if ((m = t.match(/^(?:years|experience|exp)\s*[:=]\s*(.+)$/is))) { d.years = m[1].trim(); return 'years'; }
  if ((m = t.match(/^(?:education|qualification|degree)\s*[:=]\s*(.+)$/is))) { d.education = m[1].trim(); return 'education'; }
  if ((m = t.match(/^add\s+skills?\s*[:=]\s*(.+)$/is))) { d.skills = d.skills.concat(m[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean)); return 'skills'; }
  if ((m = t.match(/^skills?\s*[:=]\s*(.+)$/is))) { d.skills = m[1].split(/[,\n]/).map((s) => s.trim()).filter(Boolean); return 'skills'; }
  if ((m = t.match(/^add\s+(?:experience|job|role)\s*[:=]\s*(.+)$/is))) {
    let body = m[1].trim(), role = '';
    const dash = body.split(/\s[-–—]\s/);
    if (dash.length > 1) { role = dash[0].trim(); body = dash.slice(1).join(' - '); }
    const bullets = body.split(/[\n;]/).map((s) => s.replace(/^[-•\s]+/, '').trim()).filter(Boolean);
    d.experiences.push({ role, bullets });
    return 'experience';
  }
  return null;
}

/* ---- finish: stash the resume, remember it, hand back the finish link ---- */
async function finishAndLink(from, data, base) {
  const token = Math.random().toString(36).slice(2, 10);
  await redis(['SET', 'resume:' + token, JSON.stringify(data), 'EX', '604800']); // 7 days for the web loader
  await setProfile(from, data); // remember this person so they can edit later
  await setState(from, { step: 0, mode: 'idle', data: { experiences: [] } });
  await send(from,
    `🎉 All set, ${firstName(data.name)}! Your resume is ready.\n\n` +
    `👉 Finish & download (free): ${base || 'https://resume4u.help'}/?r=${token}\n\n` +
    `Pick a template, tweak anything, and download as PDF.\n\n` +
    `Reply "edit" to change something here, or "new" to build another.`);
}

/* ---- WhatsApp send ---- */
async function send(to, text) {
  const token = process.env.WHATSAPP_TOKEN, phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) { console.log('[whatsapp] NOT SENT — missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID. Would send to', to, ':', text); return; }
  const resp = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } })
  });
  if (!resp.ok) {
    let body = ''; try { body = await resp.text(); } catch (e) {}
    console.error('[whatsapp] SEND FAILED', resp.status, body); // e.g. recipient not in allowed list, or token expired
  } else {
    console.log('[whatsapp] sent ok to', to);
  }
}

/* ---- main handler ---- */
exports.handler = async (event) => {
  // 1) Webhook verification (Meta calls this once with GET)
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    // One-time admin helpers, all guarded by the verify token so only the owner
    // can trigger them. The WABA id can come from ?waba=<id> (highest priority),
    // the WHATSAPP_WABA_ID env var, or the hardcoded fallback.
    const _admin = q.admin && q.key === process.env.WHATSAPP_VERIFY_TOKEN;
    // ?token=<override> lets a one-time admin call use a different token (e.g. the
    // Step-1 temporary token, which has full permission over the test WABA) when
    // the stored System User token can't manage the WhatsApp Business Account.
    const _tok = q.token || process.env.WHATSAPP_TOKEN || '';
    const wabaId = q.waba || process.env.WHATSAPP_WABA_ID || '2356692575145331';

    // whoami: ask Meta what this token can see. debug_token lists granular
    // scopes with target_ids, which include the WhatsApp Business Account id(s)
    // the token is allowed to act on — that's the id to use for ?waba=.
    if (_admin && q.admin === 'whoami') {
      try {
        const r = await fetch(`${GRAPH}/debug_token?input_token=${encodeURIComponent(_tok)}&access_token=${encodeURIComponent(_tok)}`);
        return { statusCode: 200, body: 'debug_token ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'whoami error: ' + (e && e.message) };
      }
    }

    // wabas: discover the WhatsApp Business Account id via the Business API
    // (me/businesses -> owned/client WABAs). Fallback when the id isn't handy.
    if (_admin && q.admin === 'wabas') {
      try {
        let out = '';
        const biz = await fetch(`${GRAPH}/me/businesses?access_token=${encodeURIComponent(_tok)}`);
        const bizBody = await biz.text().catch(() => '');
        out += 'me/businesses ' + biz.status + ': ' + bizBody + '\n\n';
        try {
          const bj = JSON.parse(bizBody);
          const bid = bj && bj.data && bj.data[0] && bj.data[0].id;
          if (bid) {
            const owned = await fetch(`${GRAPH}/${bid}/owned_whatsapp_business_accounts?access_token=${encodeURIComponent(_tok)}`);
            out += 'owned_wabas ' + owned.status + ': ' + (await owned.text().catch(() => '')) + '\n\n';
            const client = await fetch(`${GRAPH}/${bid}/client_whatsapp_business_accounts?access_token=${encodeURIComponent(_tok)}`);
            out += 'client_wabas ' + client.status + ': ' + (await client.text().catch(() => ''));
          }
        } catch (e) { out += 'parse: ' + (e && e.message); }
        return { statusCode: 200, body: out };
      } catch (e) {
        return { statusCode: 200, body: 'wabas error: ' + (e && e.message) };
      }
    }

    // selftest: report which env vars are present (booleans, no secret values)
    // and whether the Upstash Redis state store round-trips. Used to diagnose the
    // "Oops — something hiccuped" path, which means the handler threw.
    if (_admin && q.admin === 'selftest') {
      const env = {
        WHATSAPP_TOKEN: !!process.env.WHATSAPP_TOKEN,
        WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID || null,
        WHATSAPP_VERIFY_TOKEN: !!process.env.WHATSAPP_VERIFY_TOKEN,
        ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
        UPSTASH_REDIS_REST_URL: !!process.env.UPSTASH_REDIS_REST_URL,
        UPSTASH_REDIS_REST_TOKEN: !!process.env.UPSTASH_REDIS_REST_TOKEN
      };
      let redisResult;
      try {
        const setr = await redis(['SET', 'wa:selftest', 'ok', 'EX', '60']);
        const getr = await redis(['GET', 'wa:selftest']);
        redisResult = 'set=' + JSON.stringify(setr) + ' get=' + JSON.stringify(getr);
      } catch (e) { redisResult = 'ERROR: ' + (e && e.message); }
      let aiResult;
      try {
        const a = await claude('Reply with the single word OK.', 10);
        aiResult = JSON.stringify(a);
      } catch (e) { aiResult = 'ERROR: ' + (e && e.message); }
      return { statusCode: 200, body: 'selftest env=' + JSON.stringify(env) + ' | redis=' + redisResult + ' | ai=' + aiResult };
    }

    // grant: assign a (system) user to the WABA with a task permission, so a
    // System User token can finally send/manage. Run with ?token=<a token that
    // already owns the WABA, e.g. the Step-1 temp token>. ?su=<user id> defaults
    // to the resume4u-whatsapp-bot system user; ?tasks= defaults to MANAGE.
    if (_admin && q.admin === 'grant') {
      const su = q.su || '61595837001313';
      const tasks = q.tasks || 'MANAGE';
      try {
        const url = `${GRAPH}/${wabaId}/assigned_users?user=${encodeURIComponent(su)}` +
          `&tasks=${encodeURIComponent('["' + tasks + '"]')}&access_token=${encodeURIComponent(_tok)}`;
        const r = await fetch(url, { method: 'POST' });
        return { statusCode: 200, body: 'grant (waba ' + wabaId + ' user ' + su + ' tasks ' + tasks + ') status ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'grant error: ' + (e && e.message) };
      }
    }

    // testsend: reproduce the bot's outbound reply (same token + phone-number id
    // the real send() uses) and return Meta's raw response, so a failing reply
    // shows its actual error. ?to=<intl number, no +>, optional ?pn= / ?token=.
    if (_admin && q.admin === 'testsend') {
      const phoneId = q.pn || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
      const to = q.to || '';
      try {
        const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + _tok, 'content-type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: 'Test from Resume4U co-pilot ✅' } })
        });
        return { statusCode: 200, body: 'testsend (pn ' + phoneId + ' to ' + to + ') status ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'testsend error: ' + (e && e.message) };
      }
    }

    // subscribe THIS app to the WhatsApp Business Account's webhooks
    // (POST /<WABA_ID>/subscribed_apps). This is the step that makes Meta route
    // the number's inbound messages to this webhook.
    if (_admin && q.admin === 'subscribe') {
      try {
        const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + _tok }
        });
        const body = await r.text().catch(() => '');
        return { statusCode: 200, body: 'subscribe_apps (waba ' + wabaId + ') status ' + r.status + ': ' + body };
      } catch (e) {
        return { statusCode: 200, body: 'subscribe_apps error: ' + (e && e.message) };
      }
    }
    // Let us read the current subscription from the browser too.
    if (_admin && q.admin === 'check') {
      try {
        const r = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          headers: { Authorization: 'Bearer ' + _tok }
        });
        return { statusCode: 200, body: 'subscribed_apps (waba ' + wabaId + ') GET ' + r.status + ': ' + (await r.text().catch(() => '')) };
      } catch (e) {
        return { statusCode: 200, body: 'check error: ' + (e && e.message) };
      }
    }
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return { statusCode: 200, body: q['hub.challenge'] || '' };
    }
    return { statusCode: 403, body: 'forbidden' };
  }
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'method not allowed' };

  // 2) Incoming message
  let msg;
  try {
    const body = JSON.parse(event.body || '{}');
    const v = body.entry && body.entry[0] && body.entry[0].changes && body.entry[0].changes[0] && body.entry[0].changes[0].value;
    msg = v && v.messages && v.messages[0];
  } catch (e) { return { statusCode: 200, body: 'ok' }; } // always 200 so Meta doesn't retry-storm
  if (!msg) return { statusCode: 200, body: 'ok' };

  const from = msg.from;
  const type = msg.type;
  const text = (msg.text && msg.text.body || '').trim();
  const low = text.toLowerCase();
  console.log('[whatsapp] inbound from', from, 'type', type, ':', JSON.stringify(text));
  const base = siteBase(event); // finish link lives on the same deploy as this webhook

  const MENU = 'Reply with a number:\n1️⃣  Edit my saved resume\n2️⃣  Start a fresh one\n3️⃣  Import a PDF (just send it here)';

  try {
    let state = await getState(from);
    if (!state.data) state.data = { experiences: [] };
    if (!state.mode) state.mode = state.step > 0 ? 'build' : 'idle'; // migrate older states

    // ---- Document / photo upload: import an existing resume (any time) ----
    if (type === 'document' || type === 'image') {
      const mediaId = (msg.document && msg.document.id) || (msg.image && msg.image.id);
      await send(from, '📄 Got it — reading your resume now, give me a few seconds…');
      const media = mediaId ? await fetchMedia(mediaId) : null;
      const data = media ? await claudeExtractResume(media.base64, media.mime) : null;
      if (!data || (!data.name && !(data.experiences || []).length && !(data.skills || []).length)) {
        await send(from, "I couldn't read that one, sorry. Send a PDF (or a clear photo) of your resume and I'll try again — or reply \"new\" to build from scratch.");
        return { statusCode: 200, body: 'ok' };
      }
      await setProfile(from, data);
      await setState(from, { step: 0, mode: 'review', data });
      await send(from, '✅ Imported your resume!\n\n' + summarize(data) +
        '\n\nReply "link" to get your polished resume, or tell me what to change — e.g.\n• role: Data Analyst\n• add skill: Python, SQL\n• years: 6');
      return { statusCode: 200, body: 'ok' };
    }

    if (type !== 'text') return { statusCode: 200, body: 'ok' };

    // ---- Global commands ----
    if (/^(restart|reset|start over|new|build new)$/i.test(low)) {
      state = { step: 0, mode: 'build', data: { experiences: [] } }; // fall through to build
    } else if (/^(menu|help|options)$/i.test(low)) {
      const prof = await getProfile(from);
      await setState(from, { step: 0, mode: 'menu', data: state.data });
      await send(from, (prof && prof.name ? 'Hi again, ' + firstName(prof.name) + '! ' : '') + MENU);
      return { statusCode: 200, body: 'ok' };
    }

    // ---- Mode: menu (returning user picking an option) ----
    if (state.mode === 'menu') {
      if (/^1\b/.test(low) || /\bedit\b/i.test(low)) {
        const prof = await getProfile(from);
        if (prof) {
          await setState(from, { step: 0, mode: 'edit', data: prof });
          await send(from, 'Editing your resume.\n\n' + summarize(prof) +
            '\n\nTell me what to change — e.g. "role: Product Manager", "add skill: Figma", "years: 7". Reply "link" when done.');
          return { statusCode: 200, body: 'ok' };
        }
        state = { step: 0, mode: 'build', data: { experiences: [] } }; // no saved resume → build
      } else if (/^2\b/.test(low) || /\b(fresh|new)\b/i.test(low)) {
        state = { step: 0, mode: 'build', data: { experiences: [] } };
      } else if (/^3\b/.test(low) || /\b(pdf|import|upload)\b/i.test(low)) {
        await setState(from, { step: 0, mode: 'review', data: { experiences: [] } });
        await send(from, '📎 Great — just send your resume as a PDF (or a clear photo) right here and I\'ll import it.');
        return { statusCode: 200, body: 'ok' };
      } else {
        await send(from, MENU);
        return { statusCode: 200, body: 'ok' };
      }
      // (option 1 w/o profile, or option 2) → state is now build; fall through
    }

    // ---- Mode: edit / review (tweak the current resume) ----
    if (state.mode === 'edit' || state.mode === 'review') {
      if (/^(link|done|finish|get link|generate|get my link)$/i.test(low)) {
        await finishAndLink(from, state.data, base);
        return { statusCode: 200, body: 'ok' };
      }
      if (/^edit$/i.test(low)) {
        await setState(from, { step: 0, mode: 'edit', data: state.data });
        await send(from, 'Sure — tell me what to change (e.g. "role: …", "add skill: …", "years: …"). Reply "link" when done.');
        return { statusCode: 200, body: 'ok' };
      }
      const changed = applyEdit(state.data, text);
      if (changed) {
        await setState(from, { step: 0, mode: 'edit', data: state.data });
        await send(from, '✅ Updated ' + changed + '.\n\n' + summarize(state.data) + '\n\nAnything else? Or reply "link" to get your resume.');
      } else {
        await send(from, 'I can change: name, role, years, education, skills, or add experience.\nExamples:\n• role: Data Analyst\n• add skill: Python\n• years: 5\n\nOr reply "link" to get your resume, "new" to start fresh.');
      }
      return { statusCode: 200, body: 'ok' };
    }

    // ---- Idle / first contact: returning user → menu, new user → build ----
    if (state.mode !== 'build') {
      const prof = await getProfile(from);
      if (prof && prof.name) {
        await setState(from, { step: 0, mode: 'menu', data: { experiences: [] } });
        await send(from, '👋 Welcome back, ' + firstName(prof.name) + '! Your resume is saved with me.\n\n' + MENU +
          '\n\nOr just send a PDF to import a different one.');
        return { statusCode: 200, body: 'ok' };
      }
      state = { step: 0, mode: 'build', data: { experiences: [] } }; // brand-new → build
    }

    // ---- Mode: build (the linear Q&A) ----
    if (state.step > 0 && STEPS[state.step - 1]) {
      await STEPS[state.step - 1].save(state.data, text);
    }
    if (state.step < STEPS.length) {
      const step = STEPS[state.step];
      const q = typeof step.ask === 'function' ? step.ask(state.data) : step.ask;
      state.step += 1;
      state.mode = 'build';
      await setState(from, state);
      await send(from, q);
    } else {
      await finishAndLink(from, state.data, base);
    }
  } catch (e) {
    console.error('[whatsapp] error', e);
    await send(from, "Oops — something hiccuped on my end. Reply anything to continue, or \"restart\" to begin again.");
  }
  return { statusCode: 200, body: 'ok' };
};
