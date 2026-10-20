/* WhatsApp Résumé Co-pilot — webhook (Meta WhatsApp Cloud API).
 *
 * Builds a résumé one reply at a time, in the gaps of someone's day: the bot asks
 * ONE question, the user sends ONE answer, Claude polishes it into résumé-grade
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
const _mem = {}; // in-memory fallback state (per warm instance)

/* ---- durable state (Upstash Redis REST, optional) ---- */
async function redis(cmd) {
  const url = process.env.UPSTASH_REDIS_REST_URL, tok = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !tok) return null;
  const r = await fetch(url + '/' + cmd.map(encodeURIComponent).join('/'), {
    headers: { Authorization: 'Bearer ' + tok }
  });
  const j = await r.json().catch(() => ({}));
  return j && j.result;
}
async function getState(from) {
  const v = await redis(['GET', 'wa:' + from]);
  if (v) { try { return JSON.parse(v); } catch (e) {} }
  return _mem[from] || { step: 0, data: { experiences: [] } };
}
async function setState(from, state) {
  _mem[from] = state;
  await redis(['SET', 'wa:' + from, JSON.stringify(state), 'EX', '86400']); // 24h TTL
}

/* ---- the conversation script ---- */
// Each step: a question to send, and how to store the user's answer.
const STEPS = [
  { ask: "Hi! 👋 I'm your Resume4U co-pilot. I'll build your résumé one quick question at a time — reply whenever you get a minute.\n\nFirst up: what's your full name?",
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
    `Turn the candidate's plain-language notes into 1-3 strong résumé bullet points for a "${role || 'professional'}" role. ` +
    `Start each with a strong verb, keep each under 22 words, don't invent numbers they didn't give (use [X]% / [N]+ placeholders where a metric would help). ` +
    `Output ONLY the bullets, one per line, no preamble.\n\nNOTES: ${raw}`, 400
  );
  return out ? out.split('\n').map((s) => s.replace(/^[-•\d.\s]+/, '').trim()).filter(Boolean).slice(0, 3)
             : [raw];
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
    const _tok = process.env.WHATSAPP_TOKEN || '';
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
  if (!msg || msg.type !== 'text') return { statusCode: 200, body: 'ok' };

  const from = msg.from;
  const text = (msg.text && msg.text.body || '').trim();
  console.log('[whatsapp] inbound from', from, ':', JSON.stringify(text));

  try {
    let state = await getState(from);

    // "restart" escape hatch
    if (/^(restart|reset|start over)$/i.test(text)) state = { step: 0, data: { experiences: [] } };

    // Save the answer to the question we just asked (step 0 is the opener — nothing to save yet)
    if (state.step > 0 && STEPS[state.step - 1]) {
      await STEPS[state.step - 1].save(state.data, text);
    }

    if (state.step < STEPS.length) {
      const step = STEPS[state.step];
      const q = typeof step.ask === 'function' ? step.ask(state.data) : step.ask;
      state.step += 1;
      await setState(from, state);
      await send(from, q);
    } else {
      // Done — stash the collected résumé and hand back a link.
      const token = Math.random().toString(36).slice(2, 10);
      await redis(['SET', 'resume:' + token, JSON.stringify(state.data), 'EX', '604800']); // 7 days
      await setState(from, { step: 0, data: { experiences: [] } }); // reset for next time
      await send(from,
        `🎉 That's everything, ${firstName(state.data.name)}! Your résumé draft is ready.\n\n` +
        `👉 Finish & download (free): https://resume4u.help/?r=${token}\n\n` +
        `Pick a template, tweak anything, and download as PDF. Reply "restart" to build another.`);
      // TODO(web): add a `?r=<token>` loader in the app (mirror of the `?jd=` hook)
      // that fetches resume:<token> and prefills the builder.
    }
  } catch (e) {
    console.error('[whatsapp] error', e);
    await send(from, "Oops — something hiccuped on my end. Reply anything to continue, or \"restart\" to begin again.");
  }
  return { statusCode: 200, body: 'ok' };
};
